use wasm_bindgen::JsCast;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DialogKeyAction {
    Close,
    Tab { shift: bool },
    Prevent,
    None,
}

pub fn dialog_key_action(key: &str, shift_key: bool, target_is_control: bool) -> DialogKeyAction {
    match key {
        "Escape" => DialogKeyAction::Close,
        "Tab" => DialogKeyAction::Tab {
            shift: shift_key,
        },
        " " if !target_is_control => DialogKeyAction::Prevent,
        _ => DialogKeyAction::None,
    }
}

pub fn activates_control(target: &web_sys::EventTarget) -> bool {
    if let Ok(el) = target.clone().dyn_into::<web_sys::Element>() {
        let tag = el.tag_name();
        return tag == "BUTTON" || tag == "SELECT" || tag == "INPUT";
    }
    false
}

pub fn next_trap_index(count: usize, current: isize, shift_key: bool) -> Option<usize> {
    if count < 1 {
        return None;
    }
    if shift_key {
        if current <= 0 {
            return Some(count - 1);
        }
        return Some((current - 1) as usize);
    }
    if current < 0 || current >= count as isize - 1 {
        return Some(0);
    }
    Some((current + 1) as usize)
}

pub fn focusable_items(root: &web_sys::Element) -> Vec<web_sys::HtmlElement> {
    let Ok(list) = root.query_selector_all(
        "a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])",
    ) else {
        return Vec::new();
    };
    let mut items = Vec::new();
    for i in 0..list.length() {
        let Some(node) = list.item(i) else {
            continue;
        };
        let Ok(el) = node.dyn_into::<web_sys::HtmlElement>() else {
            continue;
        };
        if el.tab_index() < 0 {
            continue;
        }
        if el
            .closest("[hidden]")
            .ok()
            .flatten()
            .is_some()
        {
            continue;
        }
        items.push(el);
    }
    items
}

pub fn active_focus_index(items: &[web_sys::HtmlElement]) -> isize {
    let Some(doc) = web_sys::window().and_then(|w| w.document()) else {
        return -1;
    };
    let Some(active) = doc.active_element() else {
        return -1;
    };
    for (index, item) in items.iter().enumerate() {
        if item.is_same_node(Some(&active)) {
            return index as isize;
        }
    }
    -1
}
