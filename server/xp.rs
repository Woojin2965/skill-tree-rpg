//! Level and XP rules. src/shared/xp.ts holds the same rules for the screen; change both together.

const GRADES: [&str; 5] = ["D", "C", "B", "A", "S"];
const GRADE_XP: [f64; 5] = [50.0, 250.0, 1_000.0, 5_000.0, 20_000.0];
const GATES: [i32; 3] = [30, 60, 90];
const MAX_LEVEL: i32 = 99;

fn index(grade: &str) -> usize {
    GRADES.iter().position(|g| *g == grade).expect("grade is checked by the database")
}

/// RuneScape curve: total XP needed to reach a level.
pub fn xp_for_level(level: i32) -> i32 {
    let points: f64 = (1..level).map(|l| (l as f64 + 300.0 * 2f64.powf(l as f64 / 7.0)).floor()).sum();
    (points / 4.0).floor() as i32
}

pub fn level_for_xp(xp: i32) -> i32 {
    (1..MAX_LEVEL).take_while(|level| xp >= xp_for_level(level + 1)).count() as i32 + 1
}

fn next_gate(passed: &[i32]) -> Option<i32> {
    GATES.into_iter().find(|gate| !passed.contains(gate))
}

/// XP keeps growing past a gate, but the level stays there until the gate is passed.
pub fn effective_level(xp: i32, passed: &[i32]) -> i32 {
    level_for_xp(xp).min(next_gate(passed).unwrap_or(MAX_LEVEL))
}

pub fn gate_due(xp: i32, passed: &[i32]) -> Option<i32> {
    next_gate(passed).filter(|gate| level_for_xp(xp) >= *gate)
}

pub fn restores_rust(grade: &str) -> bool {
    grade != "D"
}

pub fn xp_per_skill(grade: &str, skill_count: usize, rusty: bool) -> i32 {
    let multiplier = if rusty && restores_rust(grade) { 1.5 } else { 1.0 };
    (GRADE_XP[index(grade)] / skill_count as f64 * multiplier).floor() as i32
}

/// `idle_seconds` is the time since the skill was last practiced, None if never.
pub fn is_rusty(level: i32, idle_seconds: Option<f64>) -> bool {
    let days = match level {
        ..20 => 14.0,
        20..40 => 30.0,
        40..60 => 60.0,
        _ => 90.0,
    };
    idle_seconds.is_some_and(|idle| idle > days * 86_400.0)
}

/// None means the problem pays nothing: a revealed D would otherwise be free XP.
pub fn grade_after_reveal(grade: &str) -> Option<&'static str> {
    index(grade).checked_sub(1).map(|lower| GRADES[lower])
}

pub fn grade_for_practice(level: i32, rusty: bool) -> &'static str {
    let grade = match level {
        ..10 => "D",
        10..30 => "C",
        30..50 => "B",
        50..70 => "A",
        _ => "S",
    };
    if rusty && !restores_rust(grade) { "C" } else { grade }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn levels_follow_the_runescape_table() {
        assert_eq!([1, 2, 30, 92, 99].map(xp_for_level), [0, 83, 13_363, 6_517_253, 13_034_431]);
        assert_eq!([0, 82, 83, 13_034_430, 13_034_431, i32::MAX].map(level_for_xp), [1, 1, 2, 98, 99, 99]);
    }

    #[test]
    fn gates_cap_the_level_until_passed() {
        assert_eq!(effective_level(xp_for_level(45), &[]), 30);
        assert_eq!(effective_level(xp_for_level(45), &[30]), 45);
        assert_eq!(gate_due(xp_for_level(29), &[]), None);
        assert_eq!(gate_due(xp_for_level(30), &[]), Some(30));
        assert_eq!(gate_due(xp_for_level(70), &[30]), Some(60));
        assert_eq!(gate_due(xp_for_level(99), &[30, 60, 90]), None);
    }

    #[test]
    fn xp_splits_and_rust_pays_extra_from_grade_c() {
        assert_eq!(xp_per_skill("B", 1, false), 1000);
        assert_eq!(xp_per_skill("A", 2, false), 2500);
        assert_eq!(xp_per_skill("S", 3, false), 6666);
        assert_eq!(xp_per_skill("C", 1, true), 375);
        assert_eq!(xp_per_skill("D", 1, true), 50);
    }

    #[test]
    fn rust_reveal_and_practice_grades() {
        let days = |d: f64| Some(d * 86_400.0);
        assert_eq!([is_rusty(19, days(14.0)), is_rusty(19, days(15.0)), is_rusty(20, days(15.0))], [false, true, false]);
        assert_eq!([is_rusty(59, days(61.0)), is_rusty(60, days(90.0)), is_rusty(60, days(91.0)), is_rusty(1, None)], [true, false, true, false]);
        assert_eq!(["S", "A", "B", "C", "D"].map(grade_after_reveal), [Some("A"), Some("B"), Some("C"), Some("D"), None]);
        assert_eq!([1, 9, 10, 29, 30, 49, 50, 69, 70, 99].map(|l| grade_for_practice(l, false)), ["D", "D", "C", "C", "B", "B", "A", "A", "S", "S"]);
        assert_eq!([grade_for_practice(5, true), grade_for_practice(40, true)], ["C", "B"]);
    }
}
