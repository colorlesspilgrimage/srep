use std::cell::RefCell;
use std::fmt::Display;
use std::rc::Rc;

use serde::de::DeserializeOwned;
use serde::Serialize;
use wasm_bindgen::prelude::*;
use wasm_bindgen_futures::future_to_promise;

use super::{convert, ClientRepository, NewConflict, NewReview, PackData};

type SharedRepository = Rc<RefCell<Option<ClientRepository>>>;

#[wasm_bindgen]
#[derive(Default)]
pub struct R12TestHandle {
    inner: SharedRepository,
}

fn js_error(message: &str) -> JsValue {
    js_sys::Error::new(message).into()
}

fn display_error(error: impl Display) -> JsValue {
    js_error(&error.to_string())
}

fn not_open_error() -> JsValue {
    js_error("repository is not open")
}

fn repository(inner: &SharedRepository) -> Result<ClientRepository, JsValue> {
    inner.borrow().as_ref().cloned().ok_or_else(not_open_error)
}

fn from_js<T: DeserializeOwned>(input: JsValue) -> Result<T, JsValue> {
    let value = convert::js_to_value(&input).map_err(display_error)?;
    serde_json::from_value(value).map_err(display_error)
}

fn to_js<T: Serialize>(value: &T) -> Result<JsValue, JsValue> {
    let value = serde_json::to_value(value).map_err(display_error)?;
    convert::value_to_js(&value).map_err(display_error)
}

#[wasm_bindgen]
impl R12TestHandle {
    pub fn open(&self) -> js_sys::Promise {
        let inner = Rc::clone(&self.inner);
        future_to_promise(async move {
            if inner.borrow().is_some() {
                return Err(js_error("repository is already open"));
            }

            let (repo, report) = ClientRepository::open().await.map_err(display_error)?;
            *inner.borrow_mut() = Some(repo);
            to_js(&report)
        })
    }

    pub fn close(&self) {
        let repo = self.inner.borrow_mut().take();
        if let Some(repo) = repo {
            repo.close();
        }
    }

    pub fn is_open(&self) -> bool {
        self.inner.borrow().is_some()
    }

    pub fn delete_database(&self) -> js_sys::Promise {
        self.close();
        future_to_promise(async move {
            ClientRepository::delete_database()
                .await
                .map_err(display_error)?;
            Ok(JsValue::UNDEFINED)
        })
    }

    pub fn device_id(&self) -> Result<String, JsValue> {
        let inner = self.inner.borrow();
        match inner.as_ref() {
            Some(repo) => Ok(repo.device_id().to_owned()),
            None => Err(not_open_error()),
        }
    }

    pub fn store_pack(&self, pack: JsValue) -> js_sys::Promise {
        let inner = Rc::clone(&self.inner);
        future_to_promise(async move {
            let repo = repository(&inner)?;
            let pack: PackData = from_js(pack)?;
            repo.store_pack(pack).await.map_err(display_error)?;
            Ok(JsValue::UNDEFINED)
        })
    }

    pub fn list_packs(&self) -> js_sys::Promise {
        let inner = Rc::clone(&self.inner);
        future_to_promise(async move {
            let repo = repository(&inner)?;
            let packs = repo.list_packs().await.map_err(display_error)?;
            to_js(&packs)
        })
    }

    pub fn get_pack(&self, pack_id: String) -> js_sys::Promise {
        let inner = Rc::clone(&self.inner);
        future_to_promise(async move {
            let repo = repository(&inner)?;
            let pack = repo.get_pack(&pack_id).await.map_err(display_error)?;
            to_js(&pack)
        })
    }

    pub fn queue_review(&self, review: JsValue) -> js_sys::Promise {
        let inner = Rc::clone(&self.inner);
        future_to_promise(async move {
            let repo = repository(&inner)?;
            let review: NewReview = from_js(review)?;
            let record = repo.queue_review(review).await.map_err(display_error)?;
            to_js(&record)
        })
    }

    pub fn pending_outbox(&self) -> js_sys::Promise {
        let inner = Rc::clone(&self.inner);
        future_to_promise(async move {
            let repo = repository(&inner)?;
            let records = repo.pending_outbox().await.map_err(display_error)?;
            to_js(&records)
        })
    }

    pub fn mark_sending(&self, review_ids: Vec<String>, sending: bool) -> js_sys::Promise {
        let inner = Rc::clone(&self.inner);
        future_to_promise(async move {
            let repo = repository(&inner)?;
            repo.mark_sending(&review_ids, sending)
                .await
                .map_err(display_error)?;
            Ok(JsValue::UNDEFINED)
        })
    }

    pub fn remove_acked(&self, review_ids: Vec<String>) -> js_sys::Promise {
        let inner = Rc::clone(&self.inner);
        future_to_promise(async move {
            let repo = repository(&inner)?;
            let removed = repo
                .remove_acked(&review_ids)
                .await
                .map_err(display_error)?;
            Ok(JsValue::from_f64(f64::from(removed)))
        })
    }

    pub fn record_conflict(&self, conflict: JsValue) -> js_sys::Promise {
        let inner = Rc::clone(&self.inner);
        future_to_promise(async move {
            let repo = repository(&inner)?;
            let conflict: NewConflict = from_js(conflict)?;
            let record = repo
                .record_conflict(conflict)
                .await
                .map_err(display_error)?;
            to_js(&record)
        })
    }

    pub fn list_conflicts(&self) -> js_sys::Promise {
        let inner = Rc::clone(&self.inner);
        future_to_promise(async move {
            let repo = repository(&inner)?;
            let records = repo.list_conflicts().await.map_err(display_error)?;
            to_js(&records)
        })
    }

    pub fn remove_conflict(&self, conflict_id: String) -> js_sys::Promise {
        let inner = Rc::clone(&self.inner);
        future_to_promise(async move {
            let repo = repository(&inner)?;
            let removed = repo
                .remove_conflict(&conflict_id)
                .await
                .map_err(display_error)?;
            Ok(JsValue::from_bool(removed))
        })
    }

    pub fn export_diagnostics(&self) -> js_sys::Promise {
        let inner = Rc::clone(&self.inner);
        future_to_promise(async move {
            let repo = repository(&inner)?;
            let diagnostics = repo.export_diagnostics().await.map_err(display_error)?;
            to_js(&diagnostics)
        })
    }
}

// Threat model: this adds no meaningful same-origin capability because page JS can already access raw IndexedDB; it is a test convenience, not a security boundary.
pub fn install_test_handle() {
    let Some(window) = web_sys::window() else {
        return;
    };

    let handle: JsValue = R12TestHandle::default().into();
    let _ = js_sys::Reflect::set(window.as_ref(), &JsValue::from_str("__srepR12"), &handle);
}
