use crate::types::NoteTypeWithTemplates;

#[derive(Debug, Clone)]
pub struct DesiredCard {
    pub template_id: String,
    pub ordinal: i32,
}

fn is_blank(s: &str) -> bool {
    s.chars().all(|c| c.is_whitespace() || c == '\u{00a0}')
}

fn render_simple(tpl: &str, fields: &[(String, String)]) -> String {
    let mut out = tpl.to_string();
    for (name, value) in fields {
        let token = format!("{{{{{}}}}}", name);
        out = out.replace(&token, value);
    }
    out
}

pub fn desired_cards(
    note_type: &NoteTypeWithTemplates,
    field_values: &[String],
) -> Vec<DesiredCard> {
    let pairs: Vec<_> = note_type
        .fields
        .iter()
        .zip(field_values.iter())
        .map(|(n, v)| (n.clone(), v.clone()))
        .collect();
    let mut templates = note_type.templates.clone();
    templates.sort_by_key(|t| t.ordinal);
    let mut out = Vec::new();
    for template in templates {
        if template.front_tpl.contains("{{cloze:") {
            continue;
        }
        let rendered = render_simple(&template.front_tpl, &pairs);
        if !is_blank(&rendered) {
            out.push(DesiredCard {
                template_id: template.id.clone(),
                ordinal: 0,
            });
        }
    }
    out
}

use crate::core::card_state::FLAG_ORPHANED;
use crate::types::CardRow;

#[derive(Debug, Clone)]
pub struct Reconciliation {
    pub create: Vec<DesiredCard>,
    pub delete_ids: Vec<String>,
    pub orphan_ids: Vec<String>,
    pub unorphan_ids: Vec<String>,
}

fn key_of(template_id: &str, ordinal: i32) -> String {
    format!("{template_id}:{ordinal}")
}

pub fn reconcile(desired: &[DesiredCard], existing: &[CardRow]) -> Reconciliation {
    let mut result = Reconciliation {
        create: Vec::new(),
        delete_ids: Vec::new(),
        orphan_ids: Vec::new(),
        unorphan_ids: Vec::new(),
    };
    let wanted: std::collections::HashSet<_> = desired
        .iter()
        .map(|c| key_of(&c.template_id, c.ordinal))
        .collect();
    let stored: std::collections::HashSet<_> = existing
        .iter()
        .map(|c| key_of(&c.template_id, c.ordinal))
        .collect();
    for card in desired {
        if !stored.contains(&key_of(&card.template_id, card.ordinal)) {
            result.create.push(card.clone());
        }
    }
    for card in existing {
        let orphaned = (card.flags & FLAG_ORPHANED) != 0;
        let key = key_of(&card.template_id, card.ordinal);
        if wanted.contains(&key) {
            if orphaned {
                result.unorphan_ids.push(card.id.clone());
            }
        } else if card.reps == 0 {
            result.delete_ids.push(card.id.clone());
        } else if !orphaned {
            result.orphan_ids.push(card.id.clone());
        }
    }
    result
}

pub fn field_checksum(sort_field: &str) -> String {
    use sha2::{Digest, Sha256};
    let mut hasher = Sha256::new();
    hasher.update(sort_field.as_bytes());
    hex::encode(hasher.finalize())
}
