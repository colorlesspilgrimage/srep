use std::collections::{HashMap, HashSet};

use crate::core::cloze::{cloze_indices, render_cloze};

pub const MAX_FIELD_NAME: usize = 50;

#[derive(Debug, Clone)]
pub enum TemplateNode {
    Text { text: String },
    Field { name: String },
    Cloze { name: String },
}

#[derive(Debug)]
pub enum ParseError {
    Invalid,
}

fn is_valid_field_name(name: &str) -> bool {
    if name.is_empty() || name.len() > MAX_FIELD_NAME || name != name.trim() {
        return false;
    }
    !name
        .chars()
        .any(|c| matches!(c, '{' | '}' | '#' | '/' | '^' | ':' | '\0'..='\u{1f}'))
}

enum TagKind {
    Field,
    Cloze,
}

struct Tag {
    kind: TagKind,
    name: String,
}

fn read_tag(body: &str) -> Option<Tag> {
    if body.starts_with('#') || body.starts_with('/') {
        return None;
    }
    let (kind, rest) = if let Some(r) = body.strip_prefix("cloze:") {
        (TagKind::Cloze, r)
    } else {
        (TagKind::Field, body)
    };
    let name = rest.trim();
    if is_valid_field_name(name) {
        Some(Tag {
            kind,
            name: name.to_string(),
        })
    } else {
        None
    }
}

pub fn parse_template(source: &str) -> Result<Vec<TemplateNode>, ParseError> {
    let mut ast = Vec::new();
    let mut cursor = 0usize;
    let mut scan = 0usize;
    loop {
        let Some(start) = source[scan..].find("{{").map(|i| i + scan) else {
            break;
        };
        let Some(close) = source[start + 2..].find("}}").map(|i| i + start + 2) else {
            break;
        };
        let body = &source[start + 2..close];
        let tag = read_tag(body);
        if tag.is_none() {
            scan = start + 1;
            continue;
        }
        if start > cursor {
            ast.push(TemplateNode::Text {
                text: source[cursor..start].to_string(),
            });
        }
        let tag = tag.unwrap();
        match tag.kind {
            TagKind::Field => ast.push(TemplateNode::Field { name: tag.name }),
            TagKind::Cloze => ast.push(TemplateNode::Cloze { name: tag.name }),
        }
        cursor = close + 2;
        scan = cursor;
    }
    if cursor < source.len() {
        ast.push(TemplateNode::Text {
            text: source[cursor..].to_string(),
        });
    }
    Ok(ast)
}

fn is_blank(s: &str) -> bool {
    s.chars().all(|c| c.is_whitespace() || c == '\u{00a0}')
}

pub fn template_fields(ast: &[TemplateNode]) -> (HashSet<String>, HashSet<String>) {
    let mut plain = HashSet::new();
    let mut cloze = HashSet::new();
    for node in ast {
        match node {
            TemplateNode::Field { name } => {
                plain.insert(name.clone());
            }
            TemplateNode::Cloze { name } => {
                cloze.insert(name.clone());
            }
            TemplateNode::Text { .. } => {}
        }
    }
    (plain, cloze)
}

pub struct RenderContext<'a> {
    pub side: &'a str,
    pub cloze_index: i32,
}

pub fn render_template(ast: &[TemplateNode], fields: &HashMap<String, String>, ctx: &RenderContext) -> String {
    let mut out = String::new();
    for node in ast {
        match node {
            TemplateNode::Text { text } => out.push_str(text),
            TemplateNode::Field { name } => {
                out.push_str(fields.get(name).map(String::as_str).unwrap_or(""));
            }
            TemplateNode::Cloze { name } => {
                let value = fields.get(name).map(String::as_str).unwrap_or("");
                out.push_str(&render_cloze(value, ctx.cloze_index, ctx.side));
            }
        }
    }
    out
}

pub fn fields_by_name(note_fields: &[String], values: &[String]) -> HashMap<String, String> {
    let mut out = HashMap::new();
    for (i, name) in note_fields.iter().enumerate() {
        out.insert(
            name.clone(),
            values.get(i).cloned().unwrap_or_default(),
        );
    }
    out
}

pub fn render_card_sides(
    front_tpl: &str,
    back_tpl: &str,
    fields: &HashMap<String, String>,
    ordinal: i32,
) -> (String, String) {
    let front_ast = parse_template(front_tpl).unwrap_or_default();
    let back_ast = parse_template(back_tpl).unwrap_or_default();
    let ctx_front = RenderContext {
        side: "front",
        cloze_index: ordinal,
    };
    let ctx_back = RenderContext {
        side: "back",
        cloze_index: ordinal,
    };
    (
        render_template(&front_ast, fields, &ctx_front),
        render_template(&back_ast, fields, &ctx_back),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn basic_front_back() {
        let fields = fields_by_name(
            &["Front".into(), "Back".into()],
            &["gato".into(), "cat".into()],
        );
        let (front, back) = render_card_sides("{{Front}}", "{{Front}}<hr>{{Back}}", &fields, 0);
        assert_eq!(front, "gato");
        assert_eq!(back, "gato<hr>cat");
    }

    #[test]
    fn cloze_preview_gap() {
        let fields = fields_by_name(
            &["Text".into(), "Extra".into()],
            &["{{c1::gato}}".into(), "".into()],
        );
        let (front, _) = render_card_sides("{{cloze:Text}}", "{{cloze:Text}}", &fields, 1);
        assert!(front.contains("[...]"));
    }
}

pub fn desired_for_template(
    template_id: &str,
    front_tpl: &str,
    fields: &HashMap<String, String>,
) -> Vec<(String, i32)> {
    let front_ast = match parse_template(front_tpl) {
        Ok(a) => a,
        Err(_) => return vec![],
    };
    let (_, cloze_fields) = template_fields(&front_ast);
    if cloze_fields.is_empty() {
        let ctx = RenderContext {
            side: "front",
            cloze_index: 0,
        };
        let rendered = render_template(&front_ast, fields, &ctx);
        if is_blank(&rendered) {
            vec![]
        } else {
            vec![(template_id.to_string(), 0)]
        }
    } else {
        let mut indices = std::collections::BTreeSet::new();
        for name in cloze_fields {
            if let Some(value) = fields.get(&name) {
                for idx in cloze_indices(value) {
                    indices.insert(idx);
                }
            }
        }
        indices
            .into_iter()
            .map(|ordinal| (template_id.to_string(), ordinal))
            .collect()
    }
}
