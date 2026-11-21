//! Grades a typed LaTeX answer against the stored one. Everything typed is untrusted: it is parsed by the small
//! grammar below, never evaluated as code, and every size is capped before any arithmetic runs.

const MAX_INPUT_CHARS: usize = 200;
const MAX_NESTING: usize = 64;
const MAX_DEPTH: usize = 20;
const MAX_LITERAL: u64 = 1_000_000;
const MAX_DECIMALS: usize = 9;
const MAX_EXPONENT: i64 = 100;
// Far below the prime, so an identity like x^(P-1) = 1 cannot be built and a wrong answer agrees at a random
// point with probability about 1e-14.
const MAX_DEGREE: u64 = 10_000;
const P: u64 = (1 << 61) - 1;

#[derive(Clone, Copy, PartialEq, Debug)]
pub enum Form {
    Any,
    Number,
    Expanded,
    Factored,
}

impl Form {
    pub fn parse(name: &str) -> Option<Form> {
        Some(match name {
            "any" => Form::Any,
            "number" => Form::Number,
            "expanded" => Form::Expanded,
            "factored" => Form::Factored,
            _ => return None,
        })
    }
}

#[derive(Clone, PartialEq)]
enum Tok {
    Num(String),
    Var(char),
    Plus,
    Minus,
    Star,
    Slash,
    Caret,
    LParen,
    RParen,
    LBrace,
    RBrace,
    Frac,
    Prime,
    Equal,
}

// ponytail: rational expressions only (+ - * / and whole powers), which is all the templates produce.
// Roots, pi and functions need a symbolic or numeric path next to the modular one.
enum Node {
    Num(String),
    Var(char),
    Add(Vec<Node>),
    Mul(Vec<Node>),
    Neg(Box<Node>),
    Div(Box<Node>, Box<Node>),
    Pow(Box<Node>, Box<Node>),
    /// Written brackets. TeX braces leave no node.
    Group(Box<Node>),
}
use Node::*;

fn tokenize(text: &str) -> Option<Vec<Tok>> {
    let mut toks = Vec::new();
    let mut chars = text.chars().peekable();
    while let Some(c) = chars.next() {
        let tok = match c {
            _ if c.is_whitespace() => continue,
            '0'..='9' => {
                let mut number = String::from(c);
                while let Some(&d) = chars.peek() {
                    if !(d.is_ascii_digit() || (d == '.' && !number.contains('.'))) {
                        break;
                    }
                    number.push(d);
                    chars.next();
                }
                if number.ends_with('.') {
                    return None;
                }
                Tok::Num(number)
            }
            'a'..='z' => Tok::Var(c),
            '+' => Tok::Plus,
            '-' | '−' => Tok::Minus,
            '*' | '·' | '×' => Tok::Star,
            '/' | '÷' => Tok::Slash,
            '^' => Tok::Caret,
            '(' => Tok::LParen,
            ')' => Tok::RParen,
            '{' => Tok::LBrace,
            '}' => Tok::RBrace,
            '=' => Tok::Equal,
            '\'' | '′' => Tok::Prime,
            '²' | '³' => {
                toks.push(Tok::Caret);
                Tok::Num(if c == '²' { "2" } else { "3" }.into())
            }
            '\\' => {
                let mut name = String::new();
                while let Some(&l) = chars.peek().filter(|l| l.is_ascii_alphabetic()) {
                    name.push(l);
                    chars.next();
                }
                match name.as_str() {
                    // A spacing command such as "\ " or "\,".
                    "" => match chars.next()? {
                        ' ' | ',' | '!' | ';' | ':' => continue,
                        _ => return None,
                    },
                    "left" | "right" => continue,
                    "frac" | "dfrac" | "tfrac" => Tok::Frac,
                    "cdot" | "times" => Tok::Star,
                    "div" => Tok::Slash,
                    "prime" => Tok::Prime,
                    _ => return None,
                }
            }
            _ => return None,
        };
        toks.push(tok);
    }
    Some(toks)
}

struct Parser {
    toks: Vec<Tok>,
    pos: usize,
    nesting: usize,
}

impl Parser {
    fn peek(&self) -> Option<&Tok> {
        self.toks.get(self.pos)
    }

    fn eat(&mut self, tok: Tok) -> Option<()> {
        (self.peek() == Some(&tok)).then(|| self.pos += 1)
    }

    fn expr(&mut self) -> Option<Node> {
        let mut terms = vec![self.term()?];
        loop {
            if self.eat(Tok::Plus).is_some() {
                terms.push(self.term()?);
            } else if self.eat(Tok::Minus).is_some() {
                terms.push(Neg(Box::new(self.term()?)));
            } else {
                break;
            }
        }
        Some(if terms.len() == 1 { terms.pop()? } else { Add(terms) })
    }

    /// A signed product: -3x^2 is Neg(3 * x^2).
    fn term(&mut self) -> Option<Node> {
        self.nesting += 1;
        if self.nesting > MAX_NESTING {
            return None;
        }
        let node = if self.eat(Tok::Minus).is_some() {
            Neg(Box::new(self.term()?))
        } else if self.eat(Tok::Plus).is_some() {
            self.term()?
        } else {
            self.product()?
        };
        self.nesting -= 1;
        Some(node)
    }

    fn product(&mut self) -> Option<Node> {
        let mut factors = vec![self.power()?];
        loop {
            if self.eat(Tok::Star).is_some() {
                factors.push(self.signed_power()?);
            } else if self.eat(Tok::Slash).is_some() {
                let below = self.signed_power()?;
                factors = vec![Div(Box::new(product_of(factors)), Box::new(below))];
            } else if matches!(self.peek(), Some(Tok::Num(_) | Tok::Var(_) | Tok::LParen | Tok::LBrace | Tok::Frac)) {
                factors.push(self.power()?);
            } else {
                return Some(product_of(factors));
            }
        }
    }

    fn signed_power(&mut self) -> Option<Node> {
        if self.eat(Tok::Minus).is_some() { Some(Neg(Box::new(self.power()?))) } else { self.power() }
    }

    fn power(&mut self) -> Option<Node> {
        let mut base = self.primary()?;
        while self.eat(Tok::Caret).is_some() {
            base = Pow(Box::new(base), Box::new(self.exponent()?));
        }
        Some(base)
    }

    fn exponent(&mut self) -> Option<Node> {
        match self.peek()?.clone() {
            // TeX raises one token: x^23 is x^2 times 3.
            Tok::Num(digits) if digits.len() > 1 => {
                if digits.contains('.') {
                    return None;
                }
                self.toks[self.pos] = Tok::Num(digits[1..].into());
                Some(Num(digits[..1].into()))
            }
            Tok::Minus => {
                self.pos += 1;
                Some(Neg(Box::new(self.exponent()?)))
            }
            _ => self.primary(),
        }
    }

    fn primary(&mut self) -> Option<Node> {
        let tok = self.peek()?.clone();
        self.pos += 1;
        match tok {
            Tok::Num(digits) => Some(Num(digits)),
            Tok::Var(name) => Some(Var(name)),
            Tok::LParen => {
                let inner = self.expr()?;
                self.eat(Tok::RParen)?;
                Some(Group(Box::new(inner)))
            }
            Tok::LBrace => {
                let inner = self.expr()?;
                self.eat(Tok::RBrace)?;
                Some(inner)
            }
            Tok::Frac => {
                self.eat(Tok::LBrace)?;
                let above = self.expr()?;
                self.eat(Tok::RBrace)?;
                self.eat(Tok::LBrace)?;
                let below = self.expr()?;
                self.eat(Tok::RBrace)?;
                Some(Div(Box::new(above), Box::new(below)))
            }
            _ => None,
        }
    }
}

fn product_of(mut factors: Vec<Node>) -> Node {
    if factors.len() == 1 { factors.remove(0) } else { Mul(factors) }
}

fn parse(toks: Vec<Tok>) -> Option<Node> {
    let mut parser = Parser { toks, pos: 0, nesting: 0 };
    let node = parser.expr()?;
    (parser.pos == parser.toks.len()).then_some(node)
}

/// A value can fairly be written out as x = 3, f(3) = 702 or f'(3) = 702. Anything else on the left, like 2x = 6,
/// is work left undone. Only the right side is graded.
fn names_value(left: &[Tok]) -> bool {
    let call = match left {
        [Tok::Var(_)] => return true,
        [Tok::Var('f'), Tok::Prime, call @ ..] => call,
        [Tok::Var('f'), Tok::Caret, Tok::LBrace, Tok::Prime, Tok::RBrace, call @ ..] => call,
        [Tok::Var('f'), call @ ..] => call,
        _ => return false,
    };
    call.first() == Some(&Tok::LParen) && matches!(parse(call.to_vec()), Some(Group(_)))
}

fn children(node: &Node) -> Vec<&Node> {
    match node {
        Num(_) | Var(_) => vec![],
        Add(items) | Mul(items) => items.iter().collect(),
        Neg(inner) | Group(inner) => vec![inner],
        Div(a, b) | Pow(a, b) => vec![a, b],
    }
}

fn depth(node: &Node) -> usize {
    1 + children(node).into_iter().map(depth).max().unwrap_or(0)
}

/// Whole and decimal digits of a literal within the size limits.
fn literal(digits: &str) -> Option<(u64, u64, u32)> {
    let (whole, decimals) = digits.split_once('.').unwrap_or((digits, ""));
    if whole.len() > 7 || decimals.len() > MAX_DECIMALS {
        return None;
    }
    let whole: u64 = whole.parse().ok()?;
    let fraction: u64 = if decimals.is_empty() { 0 } else { decimals.parse().ok()? };
    (whole <= MAX_LITERAL).then_some((whole, fraction, decimals.len() as u32))
}

/// A whole exponent, at most MAX_EXPONENT either way. Anything else could be a power tower or a root.
fn small_exponent(node: &Node) -> Option<i64> {
    match node {
        Num(digits) if !digits.contains('.') => digits.parse().ok().filter(|e| *e <= MAX_EXPONENT),
        Neg(inner) => small_exponent(inner).map(|e| -e),
        Group(inner) => small_exponent(inner),
        _ => None,
    }
}

/// An upper bound on the degree, or None when a literal, an exponent or the degree itself is out of bounds.
fn degree(node: &Node) -> Option<u64> {
    let bound = match node {
        Num(digits) => literal(digits).map(|_| 0)?,
        Var(_) => 1,
        Add(items) => items.iter().map(degree).try_fold(0, |most, d| Some(most.max(d?)))?,
        Mul(items) => items.iter().map(degree).try_fold(0u64, |sum, d| Some(sum.saturating_add(d?)))?,
        Neg(inner) | Group(inner) => degree(inner)?,
        Div(a, b) => degree(a)?.saturating_add(degree(b)?),
        Pow(base, exponent) => degree(base)?.saturating_mul(small_exponent(exponent)?.unsigned_abs()),
    };
    (bound <= MAX_DEGREE).then_some(bound)
}

fn mul(a: u64, b: u64) -> u64 {
    (a as u128 * b as u128 % P as u128) as u64
}

fn power(mut base: u64, mut exponent: u64) -> u64 {
    let mut result = 1;
    while exponent > 0 {
        if exponent & 1 == 1 {
            result = mul(result, base);
        }
        base = mul(base, base);
        exponent >>= 1;
    }
    result
}

fn inverse(a: u64) -> Option<u64> {
    (a != 0).then(|| power(a, P - 2))
}

/// The value in the field of integers mod P, with `at` giving each letter a value. None is a division by zero.
fn eval(node: &Node, at: &[u64; 26]) -> Option<u64> {
    Some(match node {
        Num(digits) => {
            let (whole, fraction, decimals) = literal(digits)?;
            let scale = 10u64.pow(decimals);
            mul(whole * scale + fraction, inverse(scale)?)
        }
        Var(name) => at[(*name as u8 - b'a') as usize],
        Add(items) => items.iter().try_fold(0, |sum, item| Some((sum + eval(item, at)?) % P))?,
        Mul(items) => items.iter().try_fold(1, |product, item| Some(mul(product, eval(item, at)?)))?,
        Neg(inner) => (P - eval(inner, at)?) % P,
        Group(inner) => eval(inner, at)?,
        Div(a, b) => mul(eval(a, at)?, inverse(eval(b, at)?)?),
        Pow(base, exponent) => {
            let (base, exponent) = (eval(base, at)?, small_exponent(exponent)?);
            let base = if exponent < 0 { inverse(base)? } else { base };
            power(base, exponent.unsigned_abs())
        }
    })
}

/// Equal as rational functions: two expressions of bounded degree that agree at random points are the same.
fn equivalent(a: &Node, b: &Node) -> bool {
    let mut agreed = 0;
    for _ in 0..8 {
        let at: [u64; 26] = std::array::from_fn(|_| rand::random::<u64>() % P);
        // A point where either side divides by zero says nothing, so it is drawn again.
        if let (Some(x), Some(y)) = (eval(a, &at), eval(b, &at)) {
            if x != y {
                return false;
            }
            agreed += 1;
            if agreed == 2 {
                return true;
            }
        }
    }
    false
}

/// A plain number as an exact fraction. 1+1 is not one: a number answer has to be worked out.
fn to_rational(node: &Node) -> Option<(i128, i128)> {
    match node {
        Num(digits) => {
            let (whole, fraction, decimals) = literal(digits)?;
            let scale = 10i128.pow(decimals);
            Some((whole as i128 * scale + fraction as i128, scale))
        }
        Group(inner) => to_rational(inner),
        Neg(inner) => to_rational(inner).map(|(n, d)| (-n, d)),
        Div(a, b) => {
            let ((an, ad), (bn, bd)) = (to_rational(a)?, to_rational(b)?);
            if bn == 0 {
                return None;
            }
            Some((an.checked_mul(bd)?, ad.checked_mul(bn)?))
        }
        _ => None,
    }
}

/// Braces and \frac leave no Group, so a sum inside a product also marks an unexpanded bracket.
fn has_bracket(node: &Node, over_sum: bool) -> bool {
    match node {
        Group(_) => true,
        Add(_) if over_sum => true,
        _ => children(node).into_iter().any(|c| has_bracket(c, over_sum || matches!(node, Mul(_) | Div(..) | Pow(..) | Neg(_)))),
    }
}

fn term_count(node: &Node) -> usize {
    match node {
        Add(items) => items.iter().map(term_count).sum(),
        _ => 1,
    }
}

fn letters(node: &Node, found: &mut Vec<char>) {
    if let Var(name) = node {
        if !found.contains(name) {
            found.push(*name);
        }
    }
    children(node).into_iter().for_each(|c| letters(c, found));
}

/// How many linear factors are written out, or None if some factor is not linear. The grader also proves the whole
/// product equal, so as many non-constant factors as the reference has forces them all to be linear.
// ponytail: linear factors only, which is all the templates produce. Irreducible quadratics need a real check.
fn factor_count(node: &Node) -> Option<u64> {
    let mut names = Vec::new();
    letters(node, &mut names);
    if names.is_empty() {
        return Some(0);
    }
    match node {
        Var(_) => Some(1),
        Group(inner) | Neg(inner) => factor_count(inner),
        Mul(items) => items.iter().map(factor_count).sum(),
        Pow(base, exponent) => match &**exponent {
            Num(_) => Some(factor_count(base)? * small_exponent(exponent).filter(|e| *e > 0)? as u64),
            _ => None,
        },
        // A sum like x+1-x is no factor, and one like 3x+18+24/x is no linear factor. Three points in a row decide:
        // a linear sum has no bend. A pole leaves no value at all.
        Add(_) => {
            let value = |x: u64| {
                let mut at = [0; 26];
                names.iter().enumerate().for_each(|(i, name)| at[(*name as u8 - b'a') as usize] = x + i as u64);
                eval(node, &at)
            };
            let (a, b, c) = (value(2)?, value(3)?, value(4)?);
            let bend = (c + 2 * P - mul(2, b) + a) % P;
            (bend == 0).then_some(if a == b { 0 } else { 1 })
        }
        _ => None,
    }
}

/// A Japanese IME commits full-width characters, and its minus key gives the long vowel mark.
fn fold_width(text: &str) -> String {
    text.chars()
        .map(|c| match c {
            '\u{FF01}'..='\u{FF5E}' => char::from_u32(c as u32 - 0xFEE0).unwrap_or(c),
            'ー' => '-',
            _ => c,
        })
        .collect()
}

pub fn grade(typed: &str, answer: &str, form: Form) -> bool {
    check(typed, answer, form).unwrap_or(false)
}

/// MathLive writes 150° as 150^{\circ} or 150\degree. Only a number answer can be in degrees.
fn strip_degree(text: &str) -> &str {
    let text = text.trim_end();
    ["^{\\circ}", "^\\circ", "\\degree", "°"].iter().find_map(|mark| text.strip_suffix(mark)).unwrap_or(text)
}

fn check(typed: &str, answer: &str, form: Form) -> Option<bool> {
    let folded = fold_width(typed);
    let input = if form == Form::Number { strip_degree(&folded) } else { folded.as_str() };
    if input.is_empty() || input.chars().count() > MAX_INPUT_CHARS {
        return None;
    }
    let mut toks = tokenize(input)?;
    if form == Form::Number {
        if let Some(equal) = toks.iter().position(|t| *t == Tok::Equal) {
            if !names_value(&toks[..equal]) {
                return None;
            }
            toks.drain(..=equal);
        }
    }
    let raw = parse(toks)?;
    let reference = parse(tokenize(answer)?)?;
    if depth(&raw) > MAX_DEPTH {
        return None;
    }
    degree(&raw)?;
    degree(&reference)?;

    Some(match form {
        Form::Number => {
            let ((an, ad), (bn, bd)) = (to_rational(&raw)?, to_rational(&reference)?);
            an.checked_mul(bd)? == bn.checked_mul(ad)?
        }
        Form::Expanded if has_bracket(&raw, false) || term_count(&raw) > term_count(&reference) => false,
        Form::Factored if factor_count(&raw)? < factor_count(&reference).unwrap_or(0) => false,
        _ => equivalent(&raw, &reference),
    })
}

#[cfg(test)]
#[path = "grade_tests.rs"]
mod tests;
