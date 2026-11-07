use js_sys::{Function, Reflect};
use serde::de::DeserializeOwned;
use serde::Serialize;
use wasm_bindgen::{JsCast, JsValue};

fn client() -> JsValue {
    let window = web_sys::window().expect("window");
    Reflect::get(&window, &JsValue::from_str("srepClient")).expect("srepClient")
}

fn call1(name: &str, arg: &JsValue) -> JsValue {
    let c = client();
    let f = Reflect::get(&c, &JsValue::from_str(name)).expect(name);
    let f: Function = f.dyn_into().expect("fn");
    f.call1(&c, arg).unwrap_or(JsValue::UNDEFINED)
}

fn call2(name: &str, a: &JsValue, b: &JsValue) -> JsValue {
    let c = client();
    let f = Reflect::get(&c, &JsValue::from_str(name)).expect(name);
    let f: Function = f.dyn_into().expect("fn");
    f.call2(&c, a, b).unwrap_or(JsValue::UNDEFINED)
}

fn call3(name: &str, a: &JsValue, b: &JsValue, c_arg: &JsValue) -> JsValue {
    let c = client();
    let f = Reflect::get(&c, &JsValue::from_str(name)).expect(name);
    let f: Function = f.dyn_into().expect("fn");
    f.call3(&c, a, b, c_arg).unwrap_or(JsValue::UNDEFINED)
}

pub fn sanitize_card_html(text: &str) -> String {
    call1("sanitizeCardHtml", &JsValue::from_str(text))
        .as_string()
        .unwrap_or_default()
}

pub fn format_interval(minutes: f64) -> String {
    call1("formatInterval", &JsValue::from(minutes))
        .as_string()
        .unwrap_or_else(|| "0m".to_string())
}

pub fn format_until(ms: f64) -> String {
    call1("formatUntil", &JsValue::from(ms))
        .as_string()
        .unwrap_or_default()
}

pub fn display_root_class(font_size: u32, reduced_motion: bool) -> String {
    let obj = js_sys::Object::new();
    let _ = Reflect::set(&obj, &JsValue::from_str("fontSize"), &JsValue::from(font_size));
    let _ = Reflect::set(
        &obj,
        &JsValue::from_str("reducedMotion"),
        &JsValue::from(reduced_motion),
    );
    let _ = Reflect::set(&obj, &JsValue::from_str("scanline"), &JsValue::FALSE);
    let _ = Reflect::set(&obj, &JsValue::from_str("cursorBlink"), &JsValue::FALSE);
    call1("displayRootClass", &obj)
        .as_string()
        .unwrap_or_else(|| "tui-display tui-font-16".to_string())
}

pub fn wrap_cloze(text: &str, start: u32, end: u32, index: u32) -> Option<String> {
    let c = client();
    let f = Reflect::get(&c, &JsValue::from_str("wrapCloze")).expect("wrapCloze");
    let f: Function = f.dyn_into().expect("fn");
    let out = f
        .call4(
            &c,
            &JsValue::from_str(text),
            &JsValue::from(start),
            &JsValue::from(end),
            &JsValue::from(index),
        )
        .unwrap_or(JsValue::NULL);
    out.as_string()
}

pub fn next_cloze_index(text: &str, pos: u32) -> u32 {
    let v = call2(
        "nextClozeIndex",
        &JsValue::from_str(text),
        &JsValue::from(pos),
    );
    v.as_f64().unwrap_or(1.0) as u32
}

pub fn chord_from_event(ev: &web_sys::KeyboardEvent) -> Option<String> {
    let obj = js_sys::Object::new();
    let _ = Reflect::set(&obj, &JsValue::from_str("key"), &JsValue::from_str(&ev.key()));
    let _ = Reflect::set(&obj, &JsValue::from_str("ctrlKey"), &JsValue::from(ev.ctrl_key()));
    let _ = Reflect::set(&obj, &JsValue::from_str("altKey"), &JsValue::from(ev.alt_key()));
    let _ = Reflect::set(&obj, &JsValue::from_str("shiftKey"), &JsValue::from(ev.shift_key()));
    let _ = Reflect::set(&obj, &JsValue::from_str("metaKey"), &JsValue::from(ev.meta_key()));
    call1("chordFromEvent", &obj).as_string()
}

pub fn palette_action_js(
    ev: &web_sys::KeyboardEvent,
    palette_open: bool,
    modal_open: bool,
    target_is_field: bool,
    binds: &JsValue,
) -> String {
    let state = js_sys::Object::new();
    let _ = Reflect::set(
        &state,
        &JsValue::from_str("modalOpen"),
        &JsValue::from(modal_open),
    );
    let _ = Reflect::set(
        &state,
        &JsValue::from_str("paletteOpen"),
        &JsValue::from(palette_open),
    );
    let _ = Reflect::set(&state, &JsValue::from_str("binds"), binds);
    let _ = Reflect::set(
        &state,
        &JsValue::from_str("targetIsField"),
        &JsValue::from(target_is_field),
    );
    let evt = js_sys::Object::new();
    let _ = Reflect::set(&evt, &JsValue::from_str("key"), &JsValue::from_str(&ev.key()));
    let _ = Reflect::set(&evt, &JsValue::from_str("ctrlKey"), &JsValue::from(ev.ctrl_key()));
    let _ = Reflect::set(&evt, &JsValue::from_str("altKey"), &JsValue::from(ev.alt_key()));
    let _ = Reflect::set(&evt, &JsValue::from_str("shiftKey"), &JsValue::from(ev.shift_key()));
    let _ = Reflect::set(&evt, &JsValue::from_str("metaKey"), &JsValue::from(ev.meta_key()));
    call2("paletteKeyAction", &evt, &state)
        .as_string()
        .unwrap_or_else(|| "none".to_string())
}

pub fn open_hint(binds: &JsValue) -> String {
    call1("openHint", binds)
        .as_string()
        .unwrap_or_else(|| "Ctrl+K palette".to_string())
}

pub fn default_keybinds() -> JsValue {
    let c = client();
    Reflect::get(&c, &JsValue::from_str("DEFAULT_KEYBINDS")).unwrap_or(JsValue::NULL)
}

pub fn copy_keybind_map(map: &JsValue) -> JsValue {
    call1("copyKeybindMap", map)
}

pub fn remap_keybind(map: &JsValue, action: &str, chord: &str) -> Result<JsValue, String> {
    let out = call3(
        "remap",
        map,
        &JsValue::from_str(action),
        &JsValue::from_str(chord),
    );
    if out.is_string() {
        Err(out.as_string().unwrap_or_default())
    } else {
        Ok(out)
    }
}

pub fn capture_key_effect(key: &str) -> String {
    call1("captureKeyEffect", &JsValue::from_str(key))
        .as_string()
        .unwrap_or_else(|| "pass".to_string())
}

pub fn close_hint(binds: &JsValue) -> String {
    call1("closeHint", binds)
        .as_string()
        .unwrap_or_else(|| "Esc close".to_string())
}

pub fn filter_command_names(commands: &[&str], filter: &str) -> Vec<String> {
    let needle = filter.trim().to_lowercase();
    if needle.is_empty() {
        return Vec::new();
    }
    commands
        .iter()
        .filter(|name| name.to_lowercase().contains(&needle))
        .map(|s| (*s).to_string())
        .collect()
}

pub fn gallery_command_names(filter: &str) -> Vec<String> {
    let out = call1("commandsFor", &JsValue::from_str(filter));
    let arr = out.dyn_ref::<js_sys::Array>().cloned().unwrap_or_default();
    arr.iter()
        .filter_map(|v| v.as_string())
        .collect()
}

pub fn accept_display_fields(
    font_size_text: &str,
    reduced_motion: bool,
) -> Result<(u32, bool), String> {
    let obj = js_sys::Object::new();
    let _ = Reflect::set(
        &obj,
        &JsValue::from_str("fontSizeText"),
        &JsValue::from_str(font_size_text),
    );
    let _ = Reflect::set(
        &obj,
        &JsValue::from_str("reducedMotion"),
        &JsValue::from(reduced_motion),
    );
    let _ = Reflect::set(&obj, &JsValue::from_str("scanline"), &JsValue::FALSE);
    let _ = Reflect::set(&obj, &JsValue::from_str("cursorBlink"), &JsValue::FALSE);
    let out = call1("acceptDisplay", &obj);
    let ok = Reflect::get(&out, &JsValue::from_str("ok"))
        .ok()
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    if !ok {
        return Err(
            Reflect::get(&out, &JsValue::from_str("error"))
                .ok()
                .and_then(|v| v.as_string())
                .unwrap_or_else(|| "Invalid display settings.".to_string()),
        );
    }
    let display = Reflect::get(&out, &JsValue::from_str("display")).unwrap_or(JsValue::NULL);
    let font = Reflect::get(&display, &JsValue::from_str("fontSize"))
        .ok()
        .and_then(|v| v.as_f64())
        .unwrap_or(16.0) as u32;
    let motion = Reflect::get(&display, &JsValue::from_str("reducedMotion"))
        .ok()
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    Ok((font, motion))
}

pub fn accept_study_day(
    timezone: &str,
    rollover_text: &str,
) -> Result<(String, u32), String> {
    let obj = js_sys::Object::new();
    let _ = Reflect::set(
        &obj,
        &JsValue::from_str("timezone"),
        &JsValue::from_str(timezone),
    );
    let _ = Reflect::set(
        &obj,
        &JsValue::from_str("rolloverText"),
        &JsValue::from_str(rollover_text),
    );
    let out = call1("acceptStudyDay", &obj);
    let ok = Reflect::get(&out, &JsValue::from_str("ok"))
        .ok()
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    if !ok {
        return Err(
            Reflect::get(&out, &JsValue::from_str("error"))
                .ok()
                .and_then(|v| v.as_string())
                .unwrap_or_else(|| "Invalid study day.".to_string()),
        );
    }
    let settings = Reflect::get(&out, &JsValue::from_str("settings")).unwrap_or(JsValue::NULL);
    let tz = Reflect::get(&settings, &JsValue::from_str("timezone"))
        .ok()
        .and_then(|v| v.as_string())
        .unwrap_or_else(|| timezone.to_string());
    let hour = Reflect::get(&settings, &JsValue::from_str("rolloverHour"))
        .ok()
        .and_then(|v| v.as_f64())
        .unwrap_or(4.0) as u32;
    Ok((tz, hour))
}

pub fn js_ok<T: DeserializeOwned>(v: &JsValue) -> Option<T> {
    serde_wasm_bindgen::from_value(v.clone()).ok()
}

pub fn to_js<T: Serialize>(v: &T) -> JsValue {
    serde_wasm_bindgen::to_value(v).unwrap_or(JsValue::NULL)
}
