use super::{Form, Form::*, grade};
use std::time::Instant;

fn accepts(input: &str, answer: &str, form: Form) {
    assert!(grade(input, answer, form), "{input} should match {answer}");
}
fn rejects(input: &str, answer: &str, form: Form) {
    assert!(!grade(input, answer, form), "{input} should not match {answer}");
}

#[test]
fn number_answers_compare_as_exact_rationals() {
    accepts("2", "2", Number);
    accepts(r"\frac{1}{2}", "0.5", Number);
    accepts(r"-\frac{3}{4}", "-0.75", Number);
    accepts(r"\frac{2}{4}", r"\frac{1}{2}", Number);
    rejects("3", "2", Number);
    rejects("1+1", "2", Number);
    rejects("x", "2", Number);
    rejects("0.1+0.2", "0.3", Number);
    rejects(r"\frac{1}{0}", "1", Number);
}

#[test]
fn number_answers_can_carry_the_sign_inside_the_fraction() {
    accepts(r"\frac{-9}{8}", r"- \frac{9}{8}", Number);
    accepts(r"\frac{9}{-8}", r"- \frac{9}{8}", Number);
    accepts(r"\frac{-6}{8}", r"-\frac{3}{4}", Number);
    accepts("-3/4", r"-\frac{3}{4}", Number);
    accepts(r"\frac{-3}{-4}", r"\frac{3}{4}", Number);
    rejects(r"\frac{-9}{-8}", r"- \frac{9}{8}", Number);
    rejects(r"\frac{1+1}{2}", "1", Number);
    rejects(r"\frac{1}{\frac{0}{1}}", "1", Number);
}

#[test]
fn number_answers_can_end_in_zeros() {
    accepts("3.0", "3", Number);
    accepts("-1.0", "-1", Number);
    accepts("2.50", r"\frac{5}{2}", Number);
    rejects("3.0", "4", Number);
}

#[test]
fn number_answers_can_name_the_variable() {
    accepts("x=3", "3", Number);
    accepts("x = 3", "3", Number);
    accepts("k=-3", "-3", Number);
    accepts(r"x=\frac{2}{5}", r"\frac{2}{5}", Number);
    rejects("x=4", "3", Number);
    rejects("x=y", "3", Number);
    rejects("2x=6", "3", Number);
    rejects("x=1+2", "3", Number);
    rejects("x=3", "x+3", Any);
}

#[test]
fn number_answers_can_name_the_function_value() {
    accepts("f(3)=702", "702", Number);
    accepts("f'(3)=702", "702", Number);
    accepts("150^{\\circ}", "150", Number);
    accepts("150\\degree", "150", Number);
    accepts("150°", "150", Number);
    rejects("150^{\\circ}", "150", Any);
    accepts("f(-2)=7", "7", Number);
    accepts(r"f'(-2)=\frac{1}{2}", r"\frac{1}{2}", Number);
    accepts(r"f\left(3\right)=702", "702", Number);
    accepts(r"f^{\prime}\left(3\right)=702", "702", Number);
    rejects("f(3)=701", "702", Number);
    rejects("f(3)=1+701", "702", Number);
    rejects("g(3)=702", "702", Number);
    rejects("f3=702", "702", Number);
    rejects("2f(3)=702", "702", Number);
    rejects("f''(3)=702", "702", Number);
    rejects("702=f(3)", "702", Number);
    rejects("f(3)(4)=702", "702", Number);
}

#[test]
fn any_form_accepts_equivalent_expressions_only() {
    accepts("3x^2+2x", "x(3x+2)", Any);
    accepts("2xy", "2yx", Any);
    accepts(r"2\cdot x", "2 x", Any);
    accepts("x^{-1}x^3", "x^2", Any);
    rejects("2x", "3x", Any);
    rejects("x^2", "x^3", Any);
    rejects(r"\frac{1}{x-x}", r"\frac{1}{x-x}", Any);
}

#[test]
fn expanded_form_rejects_brackets_and_uncollected_terms() {
    accepts("x^2+5x+6", "x^2+5x+6", Expanded);
    accepts("6+5x+x^2", "x^2+5x+6", Expanded);
    accepts("x^2-1", "x^2-1", Expanded);
    rejects("(x+2)(x+3)", "x^2+5x+6", Expanded);
    rejects("(x+1)^2", "x^2+2x+1", Expanded);
    rejects("x^2+2x+3x+6", "x^2+5x+6", Expanded);
}

#[test]
fn expanded_form_rejects_a_product_hidden_in_braces_or_a_fraction() {
    for input in ["{x+2}{x+3}", r"{x+2}\cdot{x+3}", r"\frac{{x+2}{x+3}}{1}", r"\frac{x+2}{\frac{1}{x+3}}"] {
        rejects(input, "x^2+5x+6", Expanded);
    }
    rejects("{x-3}{x+1}", "x^2-2x-3", Expanded);
    rejects("{x+2}^2", "x^2+4x+4", Expanded);
    rejects("-{x+2}", "-x-2", Expanded);
    rejects("{2x}{3x+1}+{x^2+1}{3}", "9x^2+2x+3", Expanded);
    rejects("4x{2x+1}+2{2x^2+2}", "12x^2+4x+4", Expanded);
    rejects(r"4x\frac{2x+1}{1}+2\frac{2x^2+2}{1}", "12x^2+4x+4", Expanded);
    accepts("-x-2", "-x-2", Expanded);
    accepts(r"\frac{1}{2}x+3", r"\frac{1}{2}x+3", Expanded);
}

#[test]
fn factored_form_needs_a_product_of_linear_factors() {
    accepts("(x+2)(x+3)", "(x+2)(x+3)", Factored);
    accepts("(x+3)(x+2)", "(x+2)(x+3)", Factored);
    accepts("2(x+1)(x-1)", "2(x-1)(x+1)", Factored);
    accepts("(x+1)^2", "(x+1)(x+1)", Factored);
    accepts("x(x+1)", "x(x+1)", Factored);
    rejects("x^2+5x+6", "(x+2)(x+3)", Factored);
    rejects("2(x^2-1)", "2(x-1)(x+1)", Factored);
    rejects("(x+2)(x+4)", "(x+2)(x+3)", Factored);
}

#[test]
fn factored_form_rejects_the_unfactored_polynomial_in_disguise() {
    for input in [
        "(x^2+5x+6)^1",
        r"\left(x^2+5x+6\right)^1",
        "-(-x^2-5x-6)^1",
        r"(x\cdot x+5x+6)\cdot1",
        r"1(x\cdot x+5x+6)",
        "(xx+5x+6)1",
        "(xx+5x+6)(1)",
        "1(xx+5x+6)",
        "(x^2+5x+6)(x+1-x)",
        r"(x^2+5x+6)\frac{x}{x}",
        r"(x^2+5x+6)x\cdot x^{-1}",
        r"\frac{(x+1)(x^2+5x+6)}{x+1}",
    ] {
        rejects(input, "(x+2)(x+3)", Factored);
    }
    rejects("(3x^2+3x-6)^1", "3(x-1)(x+2)", Factored);
    accepts("((x+2)(x+3))^1", "(x+2)(x+3)", Factored);
    accepts("-(x+2)(-x-3)", "(x+2)(x+3)", Factored);
    accepts("(2x+2)(x+3)", "2(x+1)(x+3)", Factored);
    accepts(r"\frac{1}{2}(2x+4)(x+3)", "(x+2)(x+3)", Factored);
}

#[test]
fn factored_form_rejects_a_fraction_hidden_in_a_bracket() {
    rejects(r"x(3x+18+\frac{24}{x})", "3(x+4)(x+2)", Factored);
    rejects(r"(x+1)(x+4+\frac{2}{x+1})", "(x+2)(x+3)", Factored);
    rejects("(x+1)(x+4+2(x+1)^{-1})", "(x+2)(x+3)", Factored);
    // A pole on a sample point must not read as linear.
    rejects(r"(x-2)(x+7+\frac{20}{x-2})", "(x+2)(x+3)", Factored);
    rejects(r"(x-3)(x+8+\frac{30}{x-3})", "(x+2)(x+3)", Factored);
    rejects(r"(x-4)(x+9+\frac{42}{x-4})", "(x+2)(x+3)", Factored);
    accepts(r"(x+\frac{1}{3})(3x+6)", "(3x+1)(x+2)", Factored);
    accepts(r"(\frac{1}{7}x+\frac{2}{7})(7x+21)", "(x+2)(x+3)", Factored);
    accepts("(0.1x+0.2)(10x+30)", "(x+2)(x+3)", Factored);
}

#[test]
fn answers_typed_with_a_japanese_ime_grade_like_half_width_ones() {
    accepts("３", "3", Number);
    accepts("－３", "-3", Number);
    accepts("ー３", "-3", Number);
    accepts("−３", "-3", Number);
    accepts("３／４", r"\frac{3}{4}", Number);
    accepts("ｘ＝３", "3", Number);
    accepts("ｘ＋２", "x+2", Any);
    accepts("ｘー２", "x-2", Any);
    accepts("ｘ＾２＋５ｘ＋６", "x^2+5x+6", Expanded);
    accepts("（ｘ＋２）（ｘ＋３）", "(x+2)(x+3)", Factored);
    rejects("４", "3", Number);
    rejects("（ｘ＋２）（ｘ＋３）", "x^2+5x+6", Expanded);
    rejects(&"ｘ".repeat(201), "x", Any);
    accepts("x²+5x+6", "x^2+5x+6", Expanded);
}

#[test]
fn mathlive_and_sympy_latex_styles_parse() {
    accepts(r"\left(x+2\right)\left(x+3\right)", r"\left(x + 2\right) \left(x + 3\right)", Factored);
    accepts("x^{2}+5x+6", "x^{2} + 5 x + 6", Expanded);
    accepts("x^23", "3x^2", Any);
}

#[test]
fn hostile_input_is_rejected_quickly() {
    let started = Instant::now();
    let many = [
        "9^{9^{9^{9}}}".to_string(),
        r"\sum_{n=1}^{1000000000} n".to_string(),
        "(x+1)^{100000}".to_string(),
        "2^{1000}".to_string(),
        "99999999999999999999".to_string(),
        r"\frac{d}{dx}x^2".to_string(),
        "x".repeat(201),
        "(".repeat(150),
        String::new(),
        "foo(".to_string(),
        "(x+1)^{100}".repeat(18),
        r"\sqrt{".repeat(30) + "x" + &"}".repeat(30),
        "((x+1)^{100}+1)".repeat(12),
        "(x+y+z)^{100}(x+y+z)^{100}+1".to_string(),
        "{x+1}^{100}".repeat(18),
        "{".repeat(99) + "x" + &"}".repeat(99),
    ];
    for input in &many {
        rejects(input, "x+1", Any);
        rejects(input, "(x+1)(x+2)", Factored);
        rejects(input, "x^2+3x+2", Expanded);
        rejects(input, "3", Number);
    }
    assert!(started.elapsed().as_millis() < 1000);
}

// Fermat: x^(p-1) = 1 for every x a sample can take, so without a degree cap this would pass as x+1.
#[test]
fn a_huge_power_cannot_hide_a_wrong_answer() {
    rejects("x+1+x(((((((((((x^{99})^{99})^{99})^{99})^{99})^{99})^{99})^{99})^{99})^{99})^{99})-x", "x+1", Any);
    rejects("x+(((x^{100})^{100})^{100})^0-1", "x+1", Any);
}

#[test]
fn composite_answer_styles() {
    let factored = r"3\left(x - 1\right)\left(x + 2\right)";
    accepts("3(x+2)(x-1)", factored, Factored);
    rejects("(x+2)(x-1)", factored, Factored);
    rejects("3x^2+3x-6", factored, Factored);

    let expanded = "12 x^{2} - 6 x y - 8 y";
    accepts("-6xy+12x^2-8y", expanded, Expanded);
    rejects("2y(3x-4)+12x^2-20xy", expanded, Expanded);
    rejects("12x^2-6xy+8y", expanded, Expanded);
}

// Needs db/problems.json from scripts/generate_seed.py.
#[test]
fn every_generated_answer_grades_as_correct() {
    let Ok(text) = std::fs::read_to_string("db/problems.json") else { return };
    let problems: serde_json::Value = serde_json::from_str(&text).unwrap();
    let problems = problems.as_array().unwrap();
    assert!(problems.len() > 400);
    for p in problems {
        let answer = p["answer"].as_str().unwrap();
        let form = Form::parse(p["form"].as_str().unwrap()).unwrap();
        accepts(answer, answer, form);
        // MathLive sends no spaces, and the grader must not accept just anything for this problem.
        accepts(&answer.replace(' ', ""), answer, form);
        rejects(if form == Number { "12345" } else { "x+12345" }, answer, form);
    }
}
