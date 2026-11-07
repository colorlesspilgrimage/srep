use wasm_bindgen::JsCast;

#[derive(Debug, Clone)]
pub enum DeckTreeKeyAction {
    None,
    Prevent,
    Tab { shift: bool },
    FocusName,
    Expand,
    Child,
    Collapse,
    Parent,
    Move { key: String },
}

pub struct DeckTreeKeyInput {
    pub key: String,
    pub shift_key: bool,
    pub modified: bool,
    pub has_children: bool,
    pub expanded: bool,
    pub is_root: bool,
    pub target_is_field: bool,
    pub modal_open: bool,
    pub palette_open: bool,
}

pub fn deck_tree_key_action(input: &DeckTreeKeyInput) -> DeckTreeKeyAction {
    if input.modal_open || input.palette_open || input.target_is_field || input.modified {
        return DeckTreeKeyAction::None;
    }
    if let Some(key) = move_key(&input.key) {
        return DeckTreeKeyAction::Move { key: key.to_string() };
    }
    if let Some(side) = horizontal(input) {
        return side;
    }
    if input.key == "Enter" {
        return DeckTreeKeyAction::FocusName;
    }
    if input.key == "Tab" {
        return DeckTreeKeyAction::Tab {
            shift: input.shift_key,
        };
    }
    if input.key == " " {
        return DeckTreeKeyAction::Prevent;
    }
    DeckTreeKeyAction::None
}

fn move_key(key: &str) -> Option<&'static str> {
    match key {
        "ArrowDown" | "j" => Some("ArrowDown"),
        "ArrowUp" | "k" => Some("ArrowUp"),
        "Home" => Some("Home"),
        "End" => Some("End"),
        _ => None,
    }
}

fn horizontal(input: &DeckTreeKeyInput) -> Option<DeckTreeKeyAction> {
    let right = input.key == "ArrowRight" || input.key == "l";
    let left = input.key == "ArrowLeft" || input.key == "h";
    if !right && !left {
        return None;
    }
    if right {
        if !input.has_children {
            return Some(DeckTreeKeyAction::None);
        }
        return if input.expanded {
            Some(DeckTreeKeyAction::Child)
        } else {
            Some(DeckTreeKeyAction::Expand)
        };
    }
    if input.has_children && input.expanded {
        return Some(DeckTreeKeyAction::Collapse);
    }
    if !input.is_root {
        return Some(DeckTreeKeyAction::Parent);
    }
    Some(DeckTreeKeyAction::None)
}

pub fn target_is_text_field(target: &web_sys::EventTarget) -> bool {
    if let Ok(el) = target.clone().dyn_into::<web_sys::Element>() {
        let tag = el.tag_name();
        if tag == "INPUT" || tag == "TEXTAREA" || tag == "SELECT" {
            return true;
        }
    }
    false
}
