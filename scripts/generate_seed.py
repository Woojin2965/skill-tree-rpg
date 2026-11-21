"""Writes db/seed.sql and db/problems.json from content/skills and SymPy templates. Offline only.

Never pass user answers through this file: sympify, parse_expr and lambdify can execute code.
"""
import hashlib
import json
import random
from math import gcd
from pathlib import Path

from sympy import (
    Interval, Rational, S, asin, cos, diff, expand, factor, ilcm, integrate, latex, limit, log, maximum, oo, pi,
    sin, solve, solveset, sqrt, symbols, tan,
)

ROOT = Path(__file__).parent.parent
PER_TEMPLATE = 200  # problems per template, fewer when a template runs out of distinct problems
GIVE_UP = 300  # consecutive duplicates before a template counts as exhausted
MIN_COMPOSITE = 5  # a promotion test needs 5 problems at its grade
x, y, k, t, h, theta = symbols("x y k t h theta")
rng = random.Random(20261106)


def nonzero(limit):
    return rng.choice([n for n in range(-limit, limit + 1) if n != 0])


def ri(low, high):
    return rng.randint(low, high)


def nz(low, high):
    return rng.choice([n for n in range(low, high + 1) if n != 0])


def pick(items):
    return rng.choice(items)


def poly(*coefficients, v=x):
    """poly(3, -4, 1) is 3x^2 - 4x + 1."""
    n = len(coefficients) - 1
    return sum(c * v ** (n - i) for i, c in enumerate(coefficients))


def signed(c):
    """' + 3', ' - 3', or nothing for 0."""
    return "" if c == 0 else (" + " if c > 0 else " - ") + str(abs(c))


def term(c, body):
    """' + 2\\sin\\theta', ' - \\sin\\theta'."""
    return (" + " if c > 0 else " - ") + ("" if abs(c) == 1 else str(abs(c))) + body


def only(solutions):
    assert len(solutions) == 1, solutions
    return solutions[0]


def product(p, q):
    return f"\\left({latex(p)}\\right)\\left({latex(q)}\\right)"


# ---------- The first templates: expression answers ----------

def linear_equation(grade):
    limit_ = {"D": 5, "C": 9, "B": 12}[grade]
    a, b = rng.randint(2, limit_), nonzero(limit_)
    root = Rational(nonzero(limit_), rng.choice([2, 3, 4]) if grade == "B" else 1)
    if grade == "D":
        return f"{latex(a * x + b)} = {a * root + b}", latex(root)
    c = a + rng.randint(1, 4)
    return f"{latex(a * x + b)} = {latex(c * x + (a - c) * root + b)}", latex(root)


def function_value(grade):
    limit_ = {"D": 3, "C": 5, "B": 7}[grade]
    a, b, n = nonzero(limit_), nonzero(limit_), nonzero(limit_)
    f = a * x + b if grade == "D" else a * x**2 + b * x + nonzero(limit_)
    return f"f(x) = {latex(f)}, \\quad f({n})", latex(f.subs(x, n))


def bracket_pair(grade):
    limit_ = {"D": 6, "C": 8, "B": 9}[grade]
    a, b = nonzero(limit_), nonzero(limit_)
    if grade == "D":
        return x + a, x + b
    if grade == "C":
        return rng.randint(2, 3) * x + a, x + b
    return rng.randint(2, 4) * x + a, rng.randint(2, 4) * x + b


def expanding(grade):
    p, q = bracket_pair(grade)
    return product(p, q), latex(expand(p * q))


def factoring(grade):
    p, q = bracket_pair(grade)
    # The brackets can share a factor, like (2x + 2)(4x + 4), and a revealed key must be fully factored.
    return latex(expand(p * q)), latex(factor(expand(p * q)))


def polynomial(grade):
    terms = {"D": 1, "C": 2, "B": 3}[grade]
    powers = rng.sample(range(2, 7), terms)
    return sum(nonzero(9) * x**n for n in powers)


def derivative(grade):
    f = polynomial(grade)
    return f"\\frac{{d}}{{dx}}\\left({latex(f)}\\right)", latex(diff(f, x))


def partial_derivative(grade):
    f = polynomial(grade) * y ** rng.randint(1, 3) + nonzero(9) * y
    return f"\\frac{{\\partial}}{{\\partial x}}\\left({latex(f)}\\right)", latex(diff(f, x))


def two_variable_pair():
    return nonzero(5) * x**2 + nonzero(9) * y, rng.randint(2, 6) * x + nonzero(9) * y


def stationary_cubic():
    """f' = 3(x - a)(x - b). Same parity keeps the coefficients of f whole."""
    a = nonzero(6)
    b = rng.choice([n for n in range(-6, 7) if n not in (0, a) and (n - a) % 2 == 0])
    return integrate(3 * (x - a) * (x - b), x) + nonzero(9), min(a, b), max(a, b)


def product_derivative():
    p, q = nonzero(5) * x**2 + nonzero(9), rng.randint(2, 6) * x + nonzero(9)
    return f"\\frac{{d}}{{dx}}\\left({product(p, q)}\\right)", latex(diff(expand(p * q), x))


def derivative_value():
    f, point = polynomial("B"), nonzero(3)
    return f"f(x) = {latex(f)}, \\quad f'({point})", latex(diff(f, x).subs(x, point))


def stationary_quadratic():
    f = nonzero(6) * x**2 + nonzero(9) * x + nonzero(9)
    return f"f(x) = {latex(f)}, \\quad f'(x) = 0", latex(solve(diff(f, x), x)[0])


def factor_derivative():
    f, a, b = stationary_cubic()
    return f"f(x) = {latex(f)}", "3" + product(x - a, x - b)


def function_equation():
    f, inner, value = nonzero(5) * x + nonzero(9), rng.randint(2, 4) * k + nonzero(5), nonzero(12)
    return f"f(x) = {latex(f)}, \\quad f({latex(inner)}) = {value}", latex(solve(f.subs(x, inner) - value, k)[0])


def partial_of_product():
    p, q = two_variable_pair()
    return f"\\frac{{\\partial}}{{\\partial x}}\\left({product(p, q)}\\right)", latex(diff(expand(p * q), x))


def partial_at_point():
    p, q = two_variable_pair()
    a, b = nonzero(3), nonzero(3)
    value = diff(expand(p * q), x).subs({x: a, y: b})
    return f"f(x, y) = {product(p, q)}, \\quad \\frac{{\\partial f}}{{\\partial x}}({a}, {b})", latex(value)


def product_stationary_point():
    p, q = bracket_pair("B")
    return f"f(x) = {product(p, q)}, \\quad f'(x) = 0", latex(solve(diff(p * q, x), x)[0])


def local_maximum():
    f, low, _ = stationary_cubic()
    return f"f(x) = {latex(f)}", latex(f.subs(x, low))


SOLVE_X = ("Solve for x.", "xを求めてください。")
SOLVE_X_FRAC = ("Solve for x. A fraction is fine.", "xを求めてください（分数でも可）。")
FIND_VALUE = ("Find the value.", "値を求めてください。")
FIND_VALUE_FRAC = ("Find the value. A fraction is fine.", "値を求めてください（分数でも可）。")

TEMPLATES = {
    "linear-equations": (linear_equation, "number", *SOLVE_X),
    "function-values": (function_value, "number", *FIND_VALUE),
    "expanding": (expanding, "expanded", "Expand.", "展開してください。"),
    "factoring": (factoring, "factored", "Factor.", "因数分解してください。"),
    "derivatives": (derivative, "any", "Differentiate.", "微分してください。"),
    "partial-derivatives": (partial_derivative, "any", "Find the partial derivative.", "偏微分してください。"),
}

# Original problems, not copied from any book.
COMPOSITES = {
    "A": [
        (("expanding", "derivatives"), product_derivative, "expanded",
         "Differentiate. Give the answer in expanded form.", "微分し、展開した形で答えてください。"),
        (("function-values", "derivatives"), derivative_value, "number", *FIND_VALUE),
        (("linear-equations", "derivatives"), stationary_quadratic, "number", *SOLVE_X),
        (("factoring", "derivatives"), factor_derivative, "factored", "Factor f'(x).", "f'(x)を因数分解してください。"),
        (("linear-equations", "function-values"), function_equation, "number", "Find k.", "kの値を求めてください。"),
        (("expanding", "partial-derivatives"), partial_of_product, "expanded",
         "Find the partial derivative. Give the answer in expanded form.", "偏微分し、展開した形で答えてください。"),
    ],
    "S": [
        (("expanding", "partial-derivatives", "function-values"), partial_at_point, "number", *FIND_VALUE),
        (("expanding", "derivatives", "linear-equations"), product_stationary_point, "number", *SOLVE_X),
        (("factoring", "derivatives", "function-values"), local_maximum, "number",
         "Find the local maximum value of f(x).", "f(x)の極大値を求めてください。"),
    ],
}


# ---------- Textbook problem types: number answers ----------
# Ported from the skill-tree design bank. Each type follows the kind of exercise in an open textbook section
# (content/SOURCES.md, by type id); no textbook problem is copied. Every answer is recomputed with SymPy.

CALC = ("Calculate.", "計算してください。")
CALC_FRAC = ("Calculate. Answer as a fraction.", "計算し、分数で答えてください。")
LIMIT = ("Evaluate the limit.", "極限値を求めてください。")
LIMIT_FRAC = ("Evaluate the limit. A fraction is fine.", "極限値を求めてください（分数でも可）。")
INTEGRAL = ("Evaluate the integral.", "定積分の値を求めてください。")
INTEGRAL_FRAC = ("Evaluate the integral. A fraction is fine.", "定積分の値を求めてください（分数でも可）。")
LARGER = ("Find the larger solution.", "大きいほうの解を答えてください。")
ARITHMETIC_TERM = ("Find the term of the arithmetic sequence.", "等差数列の項を求めてください。")
GEOMETRIC_TERM = ("Find the term of the geometric sequence.", "等比数列の項を求めてください。")
AREA = ("Find the area of the region enclosed by the two graphs. A fraction is fine.",
        "2つのグラフで囲まれた部分の面積を求めてください（分数でも可）。")
TRIPLES = [(3, 4, 5), (5, 12, 13), (8, 15, 17), (7, 24, 25), (20, 21, 29)]
TRIG = {"sin": sin, "cos": cos, "tan": tan}


def at(f, point):
    return f.subs(x, point)


def arith_d1():
    a, b, c = ri(2, 20), ri(2, 9), ri(2, 9)
    return f"{a} + {b} \\times {c}", a + b * c, *CALC


def arith_c1():
    a, b, c = ri(2, 15), ri(2, 15), ri(2, 15)
    return f"-{a} + (-{b}) - (-{c})", -a - b + c, *CALC


def arith_c2():
    p, q = pick([(4, 6), (6, 8), (6, 9), (8, 12), (9, 12), (10, 15), (12, 18), (12, 16), (14, 21), (15, 20), (18, 24), (20, 30)])
    return f"\\operatorname{{lcm}}({p}, {q})", ilcm(p, q), "Find the least common multiple.", "最小公倍数を求めてください。"


def arith_b1():
    p, q = pick([(4, 6), (3, 4), (6, 8), (5, 6), (8, 12), (9, 12), (10, 15), (4, 10), (6, 9)])
    a, c = ri(1, p - 1), ri(1, q - 1)
    return f"\\frac{{{a}}}{{{p}}} + \\frac{{{c}}}{{{q}}}", Rational(a, p) + Rational(c, q), *CALC_FRAC


def arith_b2():
    b, d = ri(3, 9), ri(3, 9)
    a, c = ri(1, b - 1), ri(1, d - 1)
    return f"\\frac{{{a}}}{{{b}}} \\div \\frac{{{c}}}{{{d}}}", Rational(a, b) / Rational(c, d), *CALC_FRAC


def linear_d1():
    root, a, b = nz(-9, 9), ri(2, 9), nz(-12, 12)
    return f"{latex(a * x + b)} = {a * root + b}", only(solve(a * x + b - (a * root + b), x)), *SOLVE_X


def linear_c1():
    root, a, b = nz(-9, 9), ri(2, 9), nz(-12, 12)
    c = pick([n for n in range(2, 10) if n != a])
    d = (a - c) * root + b
    return f"{latex(a * x + b)} = {latex(c * x + d)}", only(solve(a * x + b - c * x - d, x)), *SOLVE_X


def linear_c2():
    root, a, b, d = nz(-8, 8), ri(2, 6), nz(-6, 6), nz(-6, 6)
    c = pick([n for n in range(2, 7) if n != a])
    e = a * (root + b) - c * (root - d)
    prompt = f"{a}\\left({latex(x + b)}\\right) = {c}\\left({latex(x - d)}\\right){signed(e)}"
    return prompt, only(solve(a * (x + b) - c * (x - d) - e, x)), *SOLVE_X


def linear_b1():
    p, q = pick([(2, 3), (2, 5), (3, 4), (3, 5), (4, 5), (2, 7), (3, 7)])
    root = p * q * nz(-3, 3)
    c = Rational(root, p) + Rational(root, q)
    return f"\\frac{{x}}{{{p}}} + \\frac{{x}}{{{q}}} = {c}", only(solve(x / p + x / q - c, x)), *SOLVE_X


def linear_b2():
    width, extra = ri(3, 15), ri(1, 6)
    perimeter = 6 * width + 2 * extra
    return ("", only(solve(2 * (x + 2 * x + extra) - perimeter, x)),
            f"A rectangle's length is {extra} cm more than twice its width. Its perimeter is {perimeter} cm. Find the width in cm.",
            f"長方形の縦は横の2倍より{extra} cm長く、周の長さは{perimeter} cmです。横の長さ（cm）を求めてください。")


def factor_d1():
    p = ri(1, 9)
    q = pick([n for n in range(1, 10) if n != p])
    assert expand((x + p) * (x + q)) == poly(1, p + q, p * q)
    return (f"{latex(poly(1, p + q, p * q))} = \\left(x + {p}\\right)\\left(x + \\square\\right)", q,
            "Find the number in the box.", "□に入る数を求めてください。")


def factor_c1():
    a, b = nz(-9, 9), nz(-9, 9)
    while a == b or a + b == 0:
        a, b = nz(-9, 9), nz(-9, 9)
    f = expand((x - a) * (x - b))
    return f"{latex(f)} = 0", max(solve(f, x)), "Find the larger root.", "2つの解のうち大きいほうを答えてください。"


def factor_c2():
    g, m = ri(2, 6), ri(2, 9)
    return (f"{latex(g * x**2 - g * m * m)} = {g}\\left(x - k\\right)\\left(x + k\\right)",
            only([r for r in solve(g * x**2 - g * m * m, x) if r > 0]), "Find the positive number k.", "正の数kを求めてください。")


def factor_b1():
    a = pick([2, 3])
    p = pick([n for n in range(-7, 8) if n % a != 0])
    f = expand((a * x + p) * (x + nz(-8, 8)))
    return (f"{latex(f)} = 0", only([r for r in solve(f, x) if r.is_integer]),
            "One root is an integer. Find it.", "解のうち整数であるものを答えてください。")


def factor_b2():
    a, b = nz(-9, 9), ri(1, 6)
    while abs(a) == b:
        a, b = nz(-9, 9), ri(1, 6)
    f = expand((x + a) * (x - b) * (x + b))
    return (f"{latex(f)} = 0", max(solve(f, x)),
            "Factor by grouping, then find the largest root.", "組み分けして因数分解し、最も大きい解を答えてください。")


def quad_d1():
    n = ri(2, 15)
    return f"x^{{2}} = {n * n}", max(solve(x**2 - n * n, x)), "Find the positive solution.", "正の解を答えてください。"


def quad_c1():
    shift, n = nz(-9, 9), ri(2, 9)
    return f"\\left({latex(x - shift)}\\right)^{{2}} = {n * n}", max(solve((x - shift) ** 2 - n * n, x)), *LARGER


def quad_c2():
    a, b, c = ri(1, 5), nz(-9, 9), nz(-6, 6)
    return f"{latex(poly(a, b, c))} = 0, \\quad b^{{2}} - 4ac", b * b - 4 * a * c, "Find the discriminant.", "判別式の値を求めてください。"


def quad_c3():
    p, c = nz(-6, 6), nz(-9, 9)
    q = c - p * p
    assert expand((x + p) ** 2 + q) == poly(1, 2 * p, c)
    return f"{latex(poly(1, 2 * p, c))} = \\left({latex(x + p)}\\right)^{{2}} + q", q, "Find q.", "qの値を求めてください。"


def quad_b1():
    a = pick([2, 3, 4])
    m = pick([n for n in range(-9, 10) if n != 0 and gcd(n, a) == 1])
    f = expand((a * x - m) * (x - nz(-6, 6)))
    return (f"{latex(f)} = 0", max(solve(f, x)),
            "Use the quadratic formula. Give the larger root.", "解の公式を使い、大きいほうの解を答えてください。")


def quad_b2():
    n = ri(3, 20)
    total = n * (n + 1)
    return ("", only([r for r in solve(x * (x + 1) - total, x) if r > 0]),
            f"The product of two consecutive positive integers is {total}. Find the smaller one.",
            f"連続する2つの正の整数の積は{total}です。小さいほうの数を求めてください。")


def seq_d1():
    a, d = ri(-9, 9), nz(-6, 6)
    return f"a_{{1}} = {a}, \\quad d = {d}, \\quad a_{{5}}", a + 4 * d, *ARITHMETIC_TERM


def seq_c1():
    a, d, n = ri(-9, 9), nz(-6, 6), ri(12, 40)
    return f"a_{{1}} = {a}, \\quad d = {d}, \\quad a_{{{n}}}", a + (n - 1) * d, *ARITHMETIC_TERM


def seq_c2():
    a, r, n = ri(1, 5), pick([2, 3, -2]), ri(4, 7)
    return f"a_{{1}} = {a}, \\quad r = {r}, \\quad a_{{{n}}}", a * r ** (n - 1), *GEOMETRIC_TERM


def seq_b1():
    a, d, n = ri(1, 9), ri(2, 6), ri(10, 30)
    return (f"{a} + {a + d} + {a + 2 * d} + \\cdots", sum(a + i * d for i in range(n)),
            f"Find the sum of the first {n} terms.", f"はじめの{n}項の和を求めてください。")


def seq_b2():
    a, d, p = ri(-9, 9), nz(-5, 5), ri(3, 5)
    q = p + ri(3, 6)
    m = q + ri(3, 8)

    def term_(n):
        return a + (n - 1) * d
    return f"a_{{{p}}} = {term_(p)}, \\quad a_{{{q}}} = {term_(q)}, \\quad a_{{{m}}}", term_(m), *ARITHMETIC_TERM


def func_d1():
    f, n = nz(-6, 6) * x + nz(-9, 9), ri(1, 6)
    return f"f(x) = {latex(f)}, \\quad f({n})", at(f, n), *FIND_VALUE


def func_c1():
    f, n = poly(nz(-4, 4), nz(-6, 6), nz(-9, 9)), -ri(1, 5)
    return f"f(x) = {latex(f)}, \\quad f({n})", at(f, n), *FIND_VALUE


def func_c2():
    f, g, n = nz(-5, 5) * x + nz(-9, 9), x**2 + nz(-6, 6), nz(-4, 4)
    return f"f(x) = {latex(f)}, \\quad g(x) = {latex(g)}, \\quad (f \\circ g)({n})", at(f, at(g, n)), *FIND_VALUE


def func_b1():
    f = pick([-5, -4, -3, -2, 2, 3, 4, 5]) * x + nz(-9, 9)
    value = at(f, nz(-6, 6))
    return f"f(x) = {latex(f)}, \\quad f^{{-1}}({value})", only(solve(f - value, x)), *FIND_VALUE


def func_b2():
    f, p = poly(nz(-4, 4), nz(-6, 6), nz(-9, 9)), ri(-4, 3)
    q = p + ri(1, 5)
    return (f"f(x) = {latex(f)}", (at(f, q) - at(f, p)) / (q - p),
            f"Find the average rate of change on [{p}, {q}].", f"区間 [{p}, {q}] での平均変化率を求めてください。")


def trig_d1():
    (a, b, _), n = pick(TRIPLES[:3]), ri(1, 4)
    a, b = a * n, b * n
    return ("", sqrt(a * a + b * b), f"A right triangle has legs {a} and {b}. Find the hypotenuse.",
            f"直角三角形の直角をはさむ2辺が{a}と{b}です。斜辺の長さを求めてください。")


def trig_c1():
    d = pick([2, 3, 4, 5, 6, 9, 10, 12])
    n = pick([m for m in range(1, 2 * d) if gcd(m, d) == 1])
    angle = "\\frac{\\pi}{" + str(d) + "}" if n == 1 else f"\\frac{{{n}\\pi}}{{{d}}}"
    return angle, n * pi / d * 180 / pi, "Convert to degrees.", "度数法に直してください。"


def right_triangle_sine():
    a, b, c = pick(TRIPLES)
    return (a, c) if rng.random() < 0.5 else (b, c)


def trig_c2():
    a, c = right_triangle_sine()
    prompt = f"\\sin\\theta = \\frac{{{a}}}{{{c}}}, \\quad 0^{{\\circ}} < \\theta < 90^{{\\circ}}, \\quad \\cos\\theta"
    return prompt, cos(asin(Rational(a, c))), *FIND_VALUE


def trig_b1():
    a, c = right_triangle_sine()
    prompt = f"\\sin\\theta = \\frac{{{a}}}{{{c}}}, \\quad 90^{{\\circ}} < \\theta < 180^{{\\circ}}, \\quad \\tan\\theta"
    return prompt, tan(pi - asin(Rational(a, c))), *FIND_VALUE


def trig_b2():
    angles = [("sin", 30), ("cos", 60), ("tan", 45), ("sin", 90), ("cos", 180), ("sin", 270), ("cos", 120), ("sin", 150),
              ("sin", 210), ("cos", 240), ("sin", 330), ("cos", 300), ("tan", 135), ("tan", 225), ("tan", 315)]
    (f, a), (g, b) = rng.sample(angles, 2)
    p, q = pick([2, 3, 4, 6]), pick([-6, -4, -3, -2, 2, 3, 4, 6])
    prompt = f"{p}\\{f} {a}^{{\\circ}}" + term(q, f"\\{g} {b}^{{\\circ}}")
    return prompt, p * TRIG[f](a * pi / 180) + q * TRIG[g](b * pi / 180), *FIND_VALUE


def explog_d1():
    b, n = pick([(2, 3), (2, 4), (2, 5), (2, 6), (3, 2), (3, 3), (3, 4), (5, 2), (5, 3), (10, 2), (10, 3)])
    return f"\\log_{{{b}}} {b**n}", log(b**n, b), *FIND_VALUE


def explog_c1():
    b, p = pick([(2, 3), (2, 4), (2, 5), (2, 6), (3, 2), (3, 3), (3, 4), (5, 2), (5, 3)])
    a = nz(-5, 5)
    return f"{b}^{{{latex(x + a)}}} = {b**p}", only(solve(x + a - log(b**p, b), x)), *SOLVE_X


def explog_c2():
    b, m = pick([2, 3]), pick([2, 3])
    n = pick([i for i in range(1, 6) if i % m != 0])
    value = log(b**n) / log(b**m)
    assert (value - Rational(n, m)).simplify() == 0
    return f"\\log_{{{b**m}}} {b**n}", Rational(n, m), *FIND_VALUE_FRAC


def explog_b1():
    b, p = pick([(2, 3), (2, 4), (2, 5), (3, 2), (3, 3), (5, 2), (10, 2)])
    a = nz(-9, 9)
    return f"\\log_{{{b}}}\\left({latex(x + a)}\\right) = {p}", only(solve(x + a - b**p, x)), *SOLVE_X


def explog_b2():
    b = pick([2, 3])
    m, n = pick([(2, 3), (1, 2), (1, 3), (3, 2), (2, 1), (3, 1)])
    p, q = nz(-4, 4), nz(-4, 4)
    return (f"{b**m}^{{{latex(x + p)}}} = {b**n}^{{{latex(x + q)}}}", only(solve(m * (x + p) - n * (x + q), x)),
            *SOLVE_X_FRAC)


def explog_b3():
    base, u, v = pick([(6, 2, 3), (10, 2, 5), (15, 3, 5)])
    n = pick([2, 3])
    return f"\\log_{{{base}}} {u**n} + \\log_{{{base}}} {v**n}", log((u * v) ** n, base), *FIND_VALUE


def limit_d1():
    f, point = poly(nz(-3, 3), nz(-5, 5), nz(-9, 9)), nz(-3, 3)
    return f"\\lim_{{x \\to {point}}} \\left({latex(f)}\\right)", limit(f, x, point), *LIMIT


def limit_c1():
    a = nz(-9, 9)
    top, bottom = x**2 - a * a, x - a
    return f"\\lim_{{x \\to {a}}} \\frac{{{latex(top)}}}{{{latex(bottom)}}}", limit(top / bottom, x, a), *LIMIT


def limit_c2():
    p, s = rng.sample([n for n in range(-7, 8) if n != 0], 2)
    top, bottom = expand((x - p) * (x - s)), x - p
    return f"\\lim_{{x \\to {p}}} \\frac{{{latex(top)}}}{{{latex(bottom)}}}", limit(top / bottom, x, p), *LIMIT


def limit_b1():
    top = poly(nz(-9, 9), nz(-9, 9), nz(-9, 9))
    bottom = poly(pick([2, 3, 4, 5, 7]), nz(-9, 9), ri(1, 9))
    return f"\\lim_{{x \\to \\infty}} \\frac{{{latex(top)}}}{{{latex(bottom)}}}", limit(top / bottom, x, oo), *LIMIT_FRAC


def limit_b2():
    p, s, q = rng.sample([n for n in range(-6, 7) if n != 0], 3)
    top, bottom = expand((x - p) * (x - s)), expand((x - p) * (x - q))
    return f"\\lim_{{x \\to {p}}} \\frac{{{latex(top)}}}{{{latex(bottom)}}}", limit(top / bottom, x, p), *LIMIT_FRAC


def diff_d1():
    f, point = x ** ri(2, 5), ri(1, 3)
    return f"f(x) = {latex(f)}, \\quad f'({point})", at(diff(f, x), point), *FIND_VALUE


def diff_c1():
    f, point = poly(nz(-3, 3), nz(-5, 5), nz(-9, 9), nz(-9, 9)), nz(-3, 3)
    return f"f(x) = {latex(f)}, \\quad f'({point})", at(diff(f, x), point), *FIND_VALUE


def diff_c2():
    f, point = poly(nz(-3, 3), nz(-5, 5), nz(-9, 9), 0), nz(-4, 4)
    return f"f(x) = {latex(f)}, \\quad f''({point})", at(diff(f, x, 2), point), *FIND_VALUE


def diff_b1():
    p, q, point = nz(-4, 4) * x + nz(-5, 5), nz(-3, 3) * x**2 + nz(-5, 5), nz(-2, 2)
    return f"f(x) = {product(p, q)}, \\quad f'({point})", at(diff(p * q, x), point), *FIND_VALUE


def diff_b2():
    a, point, n = pick([-3, -2, 2, 3]), nz(-2, 2), ri(3, 5)
    b = pick([-3, -2, -1, 1, 2, 3]) - a * point
    while b == 0:
        b = pick([-3, -2, -1, 1, 2, 3]) - a * point
    inner = a * x + b
    return f"f(x) = \\left({latex(inner)}\\right)^{{{n}}}, \\quad f'({point})", at(diff(inner**n, x), point), *FIND_VALUE


def diff_b3():
    f, point = poly(nz(-4, 4), nz(-6, 6), nz(-9, 9)), nz(-3, 3)
    slope = at(diff(f, x), point)
    return (f"y = {latex(f)}", at(f, point) - slope * point,
            f"Find the y-intercept of the tangent line at x = {point}.", f"x = {point} における接線のy切片を求めてください。")


def integral(f, low, high):
    return f"\\int_{{{low}}}^{{{high}}} \\left({latex(f)}\\right) dx", integrate(f, (x, low, high))


def integ_d1():
    n, high = ri(2, 9), ri(2, 9)
    return f"\\int_{{0}}^{{{high}}} {n} \\, dx", integrate(n, (x, 0, high)), *INTEGRAL


def integ_c1():
    low = ri(-3, 2)
    return *integral(2 * nz(-4, 4) * x + nz(-6, 6), low, low + ri(1, 4)), *INTEGRAL


def integ_c2():
    return *integral(poly(3 * nz(-3, 3), 2 * nz(-4, 4), nz(-6, 6)), 0, ri(1, 3)), *INTEGRAL


def integ_b1():
    low = ri(-2, 1)
    return *integral(poly(nz(-4, 4), nz(-5, 5), nz(-6, 6)), low, low + ri(1, 3)), *INTEGRAL_FRAC


def integ_b2():
    a, n = ri(1, 3), ri(2, 4)
    prompt = f"\\int_{{0}}^{{1}} 2x\\left(x^{{2}} + {a}\\right)^{{{n}}} dx"
    return prompt, integrate(2 * x * (x**2 + a) ** n, (x, 0, 1)), *INTEGRAL_FRAC


def partial_at(f, variable, p, q):
    return f"f(x, y) = {latex(f)}, \\quad \\frac{{\\partial f}}{{\\partial {variable}}}({p}, {q})"


def partial_d1():
    f, p, q = nz(-5, 5) * x**2 + nz(-9, 9) * y, nz(-4, 4), nz(-4, 4)
    return partial_at(f, "x", p, q), diff(f, x).subs({x: p, y: q}), *FIND_VALUE


def partial_c1():
    f, p, q = nz(-4, 4) * x**2 * y + nz(-4, 4) * y**3, nz(-3, 3), nz(-3, 3)
    return partial_at(f, "x", p, q), diff(f, x).subs({x: p, y: q}), *FIND_VALUE


def partial_c2():
    f, p, q = nz(-4, 4) * x**2 * y + nz(-4, 4) * y**3, nz(-3, 3), nz(-3, 3)
    return partial_at(f, "y", p, q), diff(f, y).subs({x: p, y: q}), *FIND_VALUE


def partial_b1():
    f, p, q = nz(-3, 3) * x**3 * y**2 + nz(-6, 6) * x * y, nz(-2, 2), nz(-3, 3)
    prompt = f"f(x, y) = {latex(f)}, \\quad \\frac{{\\partial^{{2}} f}}{{\\partial x \\partial y}}({p}, {q})"
    return prompt, diff(f, x, y).subs({x: p, y: q}), *FIND_VALUE


def partial_b2():
    f = nz(-3, 3) * x**3 + nz(-3, 3) * x**2 * y**2 + nz(-3, 3) * y**3
    p, q = nz(-2, 2), nz(-2, 2)
    second = "\\frac{\\partial^{2} f}{\\partial x^{2}} + \\frac{\\partial^{2} f}{\\partial y^{2}}"
    return (f"f(x, y) = {latex(f)}, \\quad \\left({second}\\right)({p}, {q})",
            (diff(f, x, 2) + diff(f, y, 2)).subs({x: p, y: q}), *FIND_VALUE)


TYPES = [
    ("arith.d1", "arithmetic", "D", arith_d1), ("arith.c1", "arithmetic", "C", arith_c1),
    ("arith.c2", "arithmetic", "C", arith_c2), ("arith.b1", "arithmetic", "B", arith_b1),
    ("arith.b2", "arithmetic", "B", arith_b2),
    ("linear.d1", "linear-equations", "D", linear_d1), ("linear.c1", "linear-equations", "C", linear_c1),
    ("linear.c2", "linear-equations", "C", linear_c2), ("linear.b1", "linear-equations", "B", linear_b1),
    ("linear.b2", "linear-equations", "B", linear_b2),
    ("factor.d1", "factoring", "D", factor_d1), ("factor.c1", "factoring", "C", factor_c1),
    ("factor.c2", "factoring", "C", factor_c2), ("factor.b1", "factoring", "B", factor_b1),
    ("factor.b2", "factoring", "B", factor_b2),
    ("quad.d1", "quadratic-equations", "D", quad_d1), ("quad.c1", "quadratic-equations", "C", quad_c1),
    ("quad.c2", "quadratic-equations", "C", quad_c2), ("quad.c3", "quadratic-equations", "C", quad_c3),
    ("quad.b1", "quadratic-equations", "B", quad_b1), ("quad.b2", "quadratic-equations", "B", quad_b2),
    ("seq.d1", "sequences", "D", seq_d1), ("seq.c1", "sequences", "C", seq_c1), ("seq.c2", "sequences", "C", seq_c2),
    ("seq.b1", "sequences", "B", seq_b1), ("seq.b2", "sequences", "B", seq_b2),
    ("func.d1", "function-values", "D", func_d1), ("func.c1", "function-values", "C", func_c1),
    ("func.c2", "function-values", "C", func_c2), ("func.b1", "function-values", "B", func_b1),
    ("func.b2", "function-values", "B", func_b2),
    ("trig.d1", "trigonometry", "D", trig_d1), ("trig.c1", "trigonometry", "C", trig_c1),
    ("trig.c2", "trigonometry", "C", trig_c2), ("trig.b1", "trigonometry", "B", trig_b1),
    ("trig.b2", "trigonometry", "B", trig_b2),
    ("explog.d1", "exponents-logs", "D", explog_d1), ("explog.c1", "exponents-logs", "C", explog_c1),
    ("explog.c2", "exponents-logs", "C", explog_c2), ("explog.b1", "exponents-logs", "B", explog_b1),
    ("explog.b2", "exponents-logs", "B", explog_b2), ("explog.b3", "exponents-logs", "B", explog_b3),
    ("limit.d1", "limits", "D", limit_d1), ("limit.c1", "limits", "C", limit_c1), ("limit.c2", "limits", "C", limit_c2),
    ("limit.b1", "limits", "B", limit_b1), ("limit.b2", "limits", "B", limit_b2),
    ("diff.d1", "derivatives", "D", diff_d1), ("diff.c1", "derivatives", "C", diff_c1),
    ("diff.c2", "derivatives", "C", diff_c2), ("diff.b1", "derivatives", "B", diff_b1),
    ("diff.b2", "derivatives", "B", diff_b2), ("diff.b3", "derivatives", "B", diff_b3),
    ("integ.d1", "integrals", "D", integ_d1), ("integ.c1", "integrals", "C", integ_c1),
    ("integ.c2", "integrals", "C", integ_c2), ("integ.b1", "integrals", "B", integ_b1),
    ("integ.b2", "integrals", "B", integ_b2),
    ("partial.d1", "partial-derivatives", "D", partial_d1), ("partial.c1", "partial-derivatives", "C", partial_c1),
    ("partial.c2", "partial-derivatives", "C", partial_c2), ("partial.b1", "partial-derivatives", "B", partial_b1),
    ("partial.b2", "partial-derivatives", "B", partial_b2),
]


# ---------- Textbook composites: A combines 2 skills, S combines 3 ----------

def a_factor_limit():
    n = nz(-6, 6)
    top, bottom = x**3 - n**3, x**2 - n * n
    return f"\\lim_{{x \\to {n}}} \\frac{{{latex(top)}}}{{{latex(bottom)}}}", limit(top / bottom, x, n), *LIMIT_FRAC


def a_quad_func():
    height = poly(-5, 10 * ri(1, 6), ri(1, 30), v=t)
    return (f"h(t) = {latex(height)}", maximum(height, t),
            "A ball's height in metres after t seconds is h(t). Find its maximum height in metres.",
            "ボールのt秒後の高さ（m）が h(t) で表されます。最高点の高さ（m）を求めてください。")


def a_diff_quad():
    p, q = sorted(rng.sample([n for n in range(-5, 6) if n != 0], 2))
    f = poly(2, -3 * (p + q), 6 * p * q, 0)
    return (f"f(x) = {latex(f)}", max(solve(diff(f, x), x)),
            "Find the larger x where f'(x) = 0.", "f'(x) = 0 となるxのうち、大きいほうを答えてください。")


def a_seq_explog():
    b = pick([2, 3])
    a = pick([n for n in range(1, 6) if n % b != 0])
    value = a * b ** (ri(5, 9 if b == 2 else 7) - 1)
    return (f"a_{{1}} = {a}, \\quad r = {b}, \\quad a_{{n}} = {value}", 1 + log(Rational(value, a), b),
            "Find n for the geometric sequence.", "等比数列について、nを求めてください。")


def a_integ_quad():
    p = ri(-4, 3)
    line = expand((x - p) * (x - p - ri(1, 5)) * -1 + x**2)
    low, high = sorted(solve(x**2 - line, x))
    return f"y = x^{{2}}, \\quad y = {latex(line)}", integrate(line - x**2, (x, low, high)), *AREA


def a_trig_quad():
    name, root = pick(["sin", "cos"]), pick([1, -1])
    n, smallest = ri(2, 5), rng.random() < 0.5
    f = TRIG[name](theta)
    equation = 2 * f**2 + (2 * n - root) * f - root * n  # (2f - root)(f + n)
    prompt = f"2\\{name}^{{2}}\\theta{term(2 * n - root, f'\\{name}\\theta')}{signed(-root * n)} = 0"
    angles = sorted(solveset(equation, theta, Interval.Ropen(0, 2 * pi)))
    answer = (angles[0] if smallest else angles[-1]) * 180 / pi
    which = ("smallest", "最も小さい") if smallest else ("largest", "最も大きい")
    return (prompt, answer, f"Find the {which[0]} θ in degrees with 0° ≤ θ < 360°.",
            f"0° ≤ θ < 360° の範囲で、θのうち{which[1]}ものを度数法で答えてください。")


def a_linear_func():
    a = nz(-5, 5)
    c = pick([n for n in range(-5, 6) if n not in (0, a)])
    point, b = nz(-6, 6), nz(-9, 9)
    f, g = a * x + b, c * x + (a * point + b - c * point)
    return (f"f(x) = {latex(f)}, \\quad g(x) = {latex(g)}", at(f, only(solve(f - g, x))),
            "Find the y-coordinate of the intersection point.", "2つのグラフの交点のy座標を求めてください。")


def a_partial_linear():
    px, py = nz(-5, 5), nz(-5, 5)
    f = x**2 + x * y + y**2 - (2 * px + py) * x - (px + 2 * py) * y
    point = solve([diff(f, x), diff(f, y)], [x, y])
    return (f"f(x, y) = {latex(f)}", point[x], "Find the x-coordinate of the critical point.",
            "臨界点（∂f/∂x = ∂f/∂y = 0 となる点）のx座標を求めてください。")


def a_arith_linear():
    """New for this app: fractions inside a linear equation, so arithmetic has grade A problems."""
    slope = Rational(ri(1, 5), pick([2, 3, 4, 5, 6]))
    while slope.is_integer:
        slope = Rational(ri(1, 5), pick([2, 3, 4, 5, 6]))
    shift, root = Rational(nz(-5, 5), ri(2, 6)), Rational(nz(-9, 9), ri(1, 4))
    right = slope * root + shift
    return f"{latex(slope * x + shift)} = {latex(right)}", only(solve(slope * x + shift - right, x)), *SOLVE_X_FRAC


def s_limit_diff_factor():
    n = ri(1, 9)
    prompt = f"\\lim_{{h \\to 0}} \\frac{{\\left({n} + h\\right)^{{3}} - {n**3}}}{{h}}"
    return prompt, limit(((n + h) ** 3 - n**3) / h, h, 0), *LIMIT


def s_func_quad_diff():
    fence = 4 * ri(3, 25)
    return ("", maximum(x * (fence - 2 * x), x, Interval(0, Rational(fence, 2))),
            f"You have {fence} m of fencing to build a rectangular pen against a straight wall, so only three sides need "
            "fencing. Find the largest possible area in m².",
            f"まっすぐな壁を1辺として、{fence} mのフェンスで長方形の囲いを作ります（フェンスを使うのは3辺だけ）。"
            "面積の最大値（m²）を求めてください。")


def s_integ_quad_func():
    b, m = ri(1, 4), ri(1, 4)
    curve, line = x**2 - b * x, m * x
    low, high = sorted(solve(curve - line, x))
    return f"y = {latex(curve)}, \\quad y = {latex(line)}", integrate(line - curve, (x, low, high)), *AREA


def s_diff_integ_func():
    slope = 2 * nz(-4, 4) * x + nz(-6, 6)
    p, value = ri(-2, 2), nz(-9, 9)
    q = pick([n for n in range(-4, 5) if n != p])
    f = integrate(slope, x)
    f += value - at(f, p)
    return f"f'(x) = {latex(slope)}, \\quad f({p}) = {value}, \\quad f({q})", at(f, q), *FIND_VALUE


def s_partial_diff_quad():
    p, q = ri(1, 3), nz(-5, 5)
    f = x**3 - 3 * p * p * x + y**2 - 2 * q * y
    for point in solve([diff(f, x), diff(f, y)], [x, y], dict=True):
        fxx, fyy, fxy = (diff(f, *v).subs(point) for v in ((x, x), (y, y), (x, y)))
        if fxx > 0 and fxx * fyy - fxy**2 > 0:
            return f"f(x, y) = {latex(f)}", f.subs(point), "Find the local minimum value of f.", "fの極小値を求めてください。"
    raise AssertionError("no local minimum")


def s_arith_func_linear():
    """New for this app: so arithmetic has grade S problems."""
    a = Rational(nz(-5, 5), ri(2, 4))
    c = Rational(nz(-5, 5), ri(2, 6))
    while c == a:
        c = Rational(nz(-5, 5), ri(2, 6))
    f, g = a * x + nz(-6, 6), c * x + Rational(nz(-9, 9), ri(1, 3))
    return f"f(x) = {latex(f)}, \\quad g(x) = {latex(g)}, \\quad f(x) = g(x)", only(solve(f - g, x)), *SOLVE_X_FRAC


def s_seq_explog_func():
    """New for this app: so sequences and exponents-logs have grade S problems."""
    p, d, n = ri(0, 4), ri(1, 3), ri(4, 10)
    total = sum(log(2**p * (2**d) ** i, 2) for i in range(n))
    prompt = (f"f(x) = \\log_{{2}} x, \\quad a_{{1}} = {2**p}, \\quad r = {2**d}, "
              f"\\quad f(a_{{1}}) + f(a_{{2}}) + \\cdots + f(a_{{{n}}})")
    return prompt, total, "a_n is a geometric sequence. Find the value.", "aₙ は等比数列です。値を求めてください。"


def s_trig_quad_func():
    """New for this app: so trigonometry has grade S problems. With s = sin θ, f = 1 - s² + bs + c on [-1, 1]."""
    b, c = pick([-2, -1, 1, 2]), nz(-9, 9)
    prompt = f"f(\\theta) = \\cos^{{2}}\\theta{term(b, '\\sin\\theta')}{signed(c)}"
    return (prompt, maximum(1 - x**2 + b * x + c, x, Interval(-1, 1)),
            "Find the maximum value of f(θ).", "f(θ)の最大値を求めてください。")


TEXTBOOK_COMPOSITES = [
    ("A.factor-limit", ("factoring", "limits"), "A", a_factor_limit),
    ("A.quad-func", ("quadratic-equations", "function-values"), "A", a_quad_func),
    ("A.diff-quad", ("derivatives", "quadratic-equations"), "A", a_diff_quad),
    ("A.seq-explog", ("sequences", "exponents-logs"), "A", a_seq_explog),
    ("A.integ-quad", ("integrals", "quadratic-equations"), "A", a_integ_quad),
    ("A.trig-quad", ("trigonometry", "quadratic-equations"), "A", a_trig_quad),
    ("A.linear-func", ("linear-equations", "function-values"), "A", a_linear_func),
    ("A.partial-linear", ("partial-derivatives", "linear-equations"), "A", a_partial_linear),
    ("A.arith-linear", ("arithmetic", "linear-equations"), "A", a_arith_linear),
    ("S.limit-diff-factor", ("limits", "derivatives", "factoring"), "S", s_limit_diff_factor),
    ("S.func-quad-diff", ("function-values", "quadratic-equations", "derivatives"), "S", s_func_quad_diff),
    ("S.integ-quad-func", ("integrals", "quadratic-equations", "function-values"), "S", s_integ_quad_func),
    ("S.diff-integ-func", ("derivatives", "integrals", "function-values"), "S", s_diff_integ_func),
    ("S.partial-diff-quad", ("partial-derivatives", "derivatives", "quadratic-equations"), "S", s_partial_diff_quad),
    ("S.arith-func-linear", ("arithmetic", "function-values", "linear-equations"), "S", s_arith_func_linear),
    ("S.seq-explog-func", ("sequences", "exponents-logs", "function-values"), "S", s_seq_explog_func),
    ("S.trig-quad-func", ("trigonometry", "quadratic-equations", "function-values"), "S", s_trig_quad_func),
]


def number(value):
    value = S(value)
    assert value.is_rational, value
    return latex(value)


def read_skill(path):
    """The frontmatter is flat by design, so a YAML parser is not needed."""
    fields, prerequisites = {}, []
    for line in path.read_text(encoding="utf-8").split("---")[1].strip().splitlines():
        if line.startswith("  - "):
            prerequisites.append(line.strip(' -"[]'))
        else:
            key, _, value = line.partition(":")
            fields[key] = value.strip()
    return fields, prerequisites


def sql(value):
    return "'" + value.replace("'", "''") + "'"


def main():
    skills = [read_skill(p) for p in sorted((ROOT / "content/skills").glob("*.md"))]
    skill_ids = {fields["rpg_id"] for fields, _ in skills}
    statements = ["BEGIN;"]
    for fields, _ in skills:
        values = ", ".join(sql(fields[k]) for k in ("rpg_id", "rpg_subject", "rpg_title_en", "rpg_title_ja"))
        statements.append(f"INSERT INTO skills (id, subject, title_en, title_ja) VALUES ({values});")
    for fields, prerequisites in skills:
        share = int(fields.get("rpg_prerequisite_share", "0"))
        assert 0 <= share <= 100, fields["rpg_id"]
        for prerequisite in prerequisites:
            statements.append(
                "INSERT INTO skill_prerequisites (skill_id, prerequisite_id, share) "
                f"VALUES ({sql(fields['rpg_id'])}, {sql(prerequisite)}, {share});"
            )

    problems = {}
    made_by_type = {}

    def add(type_id, ids, grade, template, form, prompt_en=None, prompt_ja=None, unique_answers=False):
        assert set(ids) <= skill_ids, ids
        made, misses, answers = 0, 0, set()
        while made < PER_TEMPLATE and misses < GIVE_UP:
            prompt, answer, *text = template()
            en, ja = text or (prompt_en, prompt_ja)
            answer = answer if isinstance(answer, str) else number(answer)
            # Word problems have no formula, so the wording is part of what makes a problem new.
            problem_id = hashlib.sha256(f"{'+'.join(ids)}|{prompt}|{en}".encode()).hexdigest()[:16]
            if problem_id in problems or (unique_answers and answer in answers):
                misses += 1
                continue
            made, misses = made + 1, 0
            answers.add(answer)
            problems[problem_id] = {
                "id": problem_id, "skills": list(ids), "grade": grade, "form": form,
                "prompt_en": en, "prompt_ja": ja, "prompt": prompt, "answer": answer,
            }
        made_by_type[type_id] = made

    for skill_id, (template, form, prompt_en, prompt_ja) in TEMPLATES.items():
        for grade in "DCB":
            # (x-4)(x-5) and (x-5)(x-4) are one problem with two ids. Numbers repeat across different equations.
            add(f"{skill_id}.{grade}", [skill_id], grade, lambda: template(grade), form, prompt_en, prompt_ja,
                unique_answers=form != "number")
    for grade, composites in COMPOSITES.items():
        for ids, template, form, prompt_en, prompt_ja in composites:
            # A reveal follows one problem. Two prompts that differ only in a constant the derivative removes
            # share an answer, so the second would pay full XP for retyping the reveal.
            add(f"{grade}.{'+'.join(ids)}", ids, grade, template, form, prompt_en, prompt_ja, unique_answers=True)
    for type_id, skill_id, grade, template in TYPES:
        add(type_id, [skill_id], grade, template, "number")
    for type_id, ids, grade, template in TEXTBOOK_COMPOSITES:
        add(type_id, ids, grade, template, "number", unique_answers=True)

    for grade, size in (("A", 2), ("S", 3)):
        graded = [p for p in problems.values() if p["grade"] == grade]
        assert all(len(p["skills"]) == size for p in graded), f"grade {grade} must combine {size} skills"
        for skill_id in skill_ids:
            count = sum(skill_id in p["skills"] for p in graded)
            assert count >= MIN_COMPOSITE, f"{skill_id} has only {count} grade {grade} problems"

    # Many rows per INSERT: one statement per row takes minutes against a remote database.
    def insert(table, rows):
        for i in range(0, len(rows), 500):
            statements.append(f"INSERT INTO {table} VALUES\n" + ",\n".join(rows[i:i + 500]) + ";")

    columns = ("id", "grade", "prompt_en", "prompt_ja", "prompt", "answer", "form")
    insert("problems (id, grade, prompt_en, prompt_ja, prompt_latex, answer_latex, answer_form)",
           ["(" + ", ".join(sql(p[k]) for k in columns) + ")" for p in problems.values()])
    insert("problem_skills (problem_id, skill_id)",
           [f"({sql(p['id'])}, {sql(skill_id)})" for p in problems.values() for skill_id in p["skills"]])
    statements.append("COMMIT;")

    (ROOT / "db/seed.sql").write_text("\n".join(statements) + "\n", encoding="utf-8")
    (ROOT / "db/problems.json").write_text(json.dumps(list(problems.values()), ensure_ascii=False, indent=1), encoding="utf-8")
    thin = {type_id: n for type_id, n in made_by_type.items() if n < 20}
    print(f"{len(skills)} skills, {len(problems)} problems. Types with under 20 problems: {thin}")


if __name__ == "__main__":
    main()
