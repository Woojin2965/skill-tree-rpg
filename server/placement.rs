//! Placement test: a binary search over the skill tree.

use std::collections::{HashMap, HashSet};

const PROBE_SIZE: usize = 2;
pub const MAX_PROBLEMS: usize = 20;

pub struct Skill {
    pub id: String,
    pub prerequisites: Vec<String>,
}

pub enum Step {
    Next(String),
    Passed(Vec<String>),
}

fn reachable<'a>(start: &'a str, edges: &HashMap<&'a str, Vec<&'a str>>) -> HashSet<&'a str> {
    let mut seen = HashSet::new();
    let mut stack = vec![start];
    while let Some(id) = stack.pop() {
        for next in edges.get(id).into_iter().flatten() {
            if seen.insert(*next) {
                stack.push(next);
            }
        }
    }
    seen
}

/// `answers` is the whole history as (skill, correct), in order, so a player can leave and resume.
/// A passed probe passes the skill and everything before it; a failed one fails it and everything after it.
pub fn step(skills: &[Skill], answers: &[(String, bool)]) -> Step {
    let ancestors: HashMap<&str, Vec<&str>> =
        skills.iter().map(|s| (s.id.as_str(), s.prerequisites.iter().map(String::as_str).collect())).collect();
    let mut descendants: HashMap<&str, Vec<&str>> = HashMap::new();
    for s in skills {
        for id in &s.prerequisites {
            descendants.entry(id).or_default().push(&s.id);
        }
    }

    let (mut passed, mut failed) = (HashSet::new(), HashSet::new());
    let mut probed: Vec<&str> = Vec::new();
    for (skill, _) in answers {
        if !probed.contains(&skill.as_str()) {
            probed.push(skill);
        }
    }
    for skill in probed {
        let probe: Vec<bool> = answers.iter().filter(|(id, _)| id == skill).map(|(_, correct)| *correct).collect();
        if probe.len() < PROBE_SIZE {
            return Step::Next(skill.into());
        }
        let (result, edges) = if probe.iter().all(|c| *c) { (&mut passed, &ancestors) } else { (&mut failed, &descendants) };
        result.insert(skill);
        result.extend(reachable(skill, edges));
    }

    let undecided: Vec<&str> =
        skills.iter().map(|s| s.id.as_str()).filter(|id| !passed.contains(id) && !failed.contains(id)).collect();
    let count = |ids: HashSet<&str>| undecided.iter().filter(|id| ids.contains(*id)).count();
    let mut best: Option<(&str, usize, usize)> = None;
    if answers.len() < MAX_PROBLEMS {
        for id in &undecided {
            let (up, down) = (count(reachable(id, &ancestors)), count(reachable(id, &descendants)));
            // The probe that best halves what is left: most even first, then the one that decides most.
            if best.is_none_or(|(_, even, total)| (up.min(down), up + down) > (even, total)) {
                best = Some((id, up.min(down), up + down));
            }
        }
    }
    match best {
        Some((id, ..)) => Step::Next(id.into()),
        None => Step::Passed(skills.iter().filter(|s| passed.contains(s.id.as_str())).map(|s| s.id.clone()).collect()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tree(edges: &[(&str, &[&str])]) -> Vec<Skill> {
        edges.iter().map(|(id, pre)| Skill { id: id.to_string(), prerequisites: pre.iter().map(|p| p.to_string()).collect() }).collect()
    }

    fn math() -> Vec<Skill> {
        tree(&[
            ("derivatives", &["factoring", "function-values"]),
            ("expanding", &["linear-equations"]),
            ("factoring", &["expanding"]),
            ("function-values", &["linear-equations"]),
            ("linear-equations", &[]),
            ("partial-derivatives", &["derivatives"]),
        ])
    }

    /// Plays a whole placement for a player who knows exactly the skills `known` accepts.
    fn play(skills: &[Skill], known: impl Fn(&str) -> bool) -> (Vec<String>, usize) {
        let mut answers = Vec::new();
        loop {
            match step(skills, &answers) {
                Step::Passed(passed) => return (passed, answers.len()),
                Step::Next(id) => {
                    let correct = known(&id);
                    answers.push((id, correct));
                }
            }
        }
    }

    #[test]
    fn the_first_probe_sits_in_the_middle_and_asks_twice() {
        assert!(matches!(step(&math(), &[]), Step::Next(id) if id == "factoring"));
        for first in [true, false] {
            assert!(matches!(step(&math(), &[("factoring".into(), first)]), Step::Next(id) if id == "factoring"));
        }
    }

    #[test]
    fn a_pass_carries_prerequisites_and_a_fail_carries_what_follows() {
        let (passed, count) = play(&math(), |id| ["linear-equations", "expanding", "factoring"].contains(&id));
        assert_eq!(passed, ["expanding", "factoring", "linear-equations"]);
        assert!(count <= 8, "{count}");
        assert_eq!(play(&math(), |_| true).0.len(), 6);
        assert_eq!(play(&math(), |_| false).0.len(), 0);
    }

    #[test]
    fn odd_trees_end_within_the_cap() {
        assert_eq!(play(&tree(&[("a", &[])]), |_| true), (vec!["a".to_string()], 2));
        let apart = tree(&[("a", &[]), ("b", &[]), ("c", &["b"])]);
        assert_eq!(play(&apart, |id| id != "c").0, ["a", "b"]);
        let names: Vec<String> = (0..300).map(|i| format!("s{i:03}")).collect();
        let chain: Vec<Skill> =
            names.iter().enumerate().map(|(i, id)| Skill { id: id.clone(), prerequisites: names[..i].iter().rev().take(1).cloned().collect() }).collect();
        let (passed, count) = play(&chain, |id| id < "s137");
        assert_eq!((passed.len(), count), (137, 16));
        let flat: Vec<Skill> = names.iter().map(|id| Skill { id: id.clone(), prerequisites: vec![] }).collect();
        let (passed, count) = play(&flat, |_| true);
        assert_eq!((passed.len(), count), (10, MAX_PROBLEMS));
    }
}
