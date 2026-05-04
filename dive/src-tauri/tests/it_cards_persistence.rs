use std::sync::Arc;

use dive_lib::auth::InMemoryKeyring;
use dive_lib::db::dao::{project as project_dao, session as session_dao};
use dive_lib::db::models::{CardState, NewProject, NewSession};
use dive_lib::dive::CardTransition;
use dive_lib::ipc::{
    card_create_impl, card_list_impl, card_reorder_impl, card_update_instruction_impl,
    workmap_get_impl, AppState,
};
use dive_lib::{Database, MockProvider};

fn mk_state() -> AppState {
    let mut db = Database::open_in_memory().unwrap();
    db.migrate().unwrap();
    AppState::new(
        db,
        Arc::new(MockProvider::new(Vec::new())),
        std::env::temp_dir(),
        "mock".into(),
    )
    .with_keyring(Arc::new(InMemoryKeyring::new()))
}

fn seed_session(state: &AppState) -> i64 {
    let db = state.db.lock().unwrap();
    let project_id = project_dao::insert(
        db.conn(),
        &NewProject {
            name: "cards-it".into(),
            path: "/tmp/dive-cards-it".into(),
            provider_default: None,
            model_default: None,
        },
    )
    .unwrap();
    session_dao::insert(
        db.conn(),
        &NewSession {
            project_id,
            title: "cards".into(),
            ended_at: None,
            status: "active".into(),
        },
    )
    .unwrap()
}

#[test]
fn cards_persist_through_create_list_update_transition_reorder_snapshot() {
    let state = mk_state();
    let session_id = seed_session(&state);

    let first = card_create_impl(&state, session_id, "first".into(), None).unwrap();
    let second = card_create_impl(&state, session_id, "second".into(), None).unwrap();
    assert_eq!(first.state, CardState::Decomposed);
    assert_eq!(second.position, 2);

    let next =
        card_update_instruction_impl(&state, first.id, "implement the first card".into()).unwrap();
    assert_eq!(next, CardState::Instructed);

    let next = dive_lib::ipc::card_transition_no_checkpoint_impl(
        &state,
        first.id,
        CardTransition::RequestVerify,
        None,
    )
    .unwrap();
    assert_eq!(next, CardState::Verifying);

    card_reorder_impl(&state, session_id, vec![second.id, first.id]).unwrap();
    let listed = card_list_impl(&state, session_id).unwrap();
    assert_eq!(
        listed.iter().map(|card| card.id).collect::<Vec<_>>(),
        vec![second.id, first.id]
    );

    let snapshot = workmap_get_impl(&state, session_id).unwrap();
    assert_eq!(snapshot.cards.len(), 2);
    assert_eq!(
        snapshot.cards[1].instruction.as_deref(),
        Some("implement the first card")
    );
    assert_eq!(snapshot.cards[1].state, CardState::Verifying);
}
