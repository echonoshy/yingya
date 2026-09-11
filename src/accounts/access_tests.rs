use super::*;

fn invite(db: &Accounts, email: Option<&str>, tokens: i64) -> Value {
    db.invite(
        InviteInput {
            email: email.map(str::to_owned),
            expires_in_days: 7,
            max_uses: 1,
            token_limit: tokens,
            media_limit: 2,
        },
        false,
    )
    .unwrap()
}
fn register(db: &Accounts, email: &str, tokens: i64) -> (User, String) {
    let invitation = invite(db, Some(email), tokens);
    db.authenticate(email, "a-test-password", invitation["code"].as_str())
        .unwrap()
}

#[test]
fn registration_requires_an_invite_and_login_requires_the_password() {
    let db = Accounts::open(Path::new(":memory:"), vec![]).unwrap();
    assert!(
        db.authenticate("a@example.com", "a-test-password", None)
            .is_err()
    );
    let invitation = invite(&db, Some(" A@Example.com "), 100);
    let code = invitation["code"].as_str();
    assert!(
        db.authenticate("other@example.com", "a-test-password", code)
            .is_err()
    );
    let (user, session) = db
        .authenticate("a@example.com", "a-test-password", code)
        .unwrap();
    assert_eq!(db.quota(&user.id).unwrap().remaining_tokens, 100);
    assert!(db.session(&session).is_some());
    assert!(
        db.authenticate("a@example.com", "wrong-password", None)
            .is_err()
    );
    assert_eq!(
        db.authenticate("A@example.com", "a-test-password", None)
            .unwrap()
            .0
            .id,
        user.id
    );
    assert!(
        db.authenticate("a@example.com", "a-test-password", code)
            .is_err()
    );
    let saved: String =
        db.0.lock()
            .unwrap()
            .query_row(
                "SELECT password_hash FROM account_access WHERE user_id=?1",
                [&user.id],
                |r| r.get(0),
            )
            .unwrap();
    assert!(saved.starts_with("$argon2id$"));
    assert!(!saved.contains("a-test-password"));
}

#[test]
fn password_reset_is_bound_single_use_and_revokes_old_sessions() {
    let db = Accounts::open(Path::new(":memory:"), vec![]).unwrap();
    let (user, session) = register(&db, "a@example.com", 100);
    let code = db.password_reset("a@example.com").unwrap()["code"]
        .as_str()
        .unwrap()
        .to_owned();
    assert!(
        db.reset_password("b@example.com", "new-test-password", &code)
            .is_err()
    );
    db.reset_password("a@example.com", "new-test-password", &code)
        .unwrap();
    assert!(db.session(&session).is_none());
    assert!(
        db.reset_password("a@example.com", "other-password", &code)
            .is_err()
    );
    assert!(
        db.authenticate("a@example.com", "a-test-password", None)
            .is_err()
    );
    assert_eq!(
        db.authenticate("a@example.com", "new-test-password", None)
            .unwrap()
            .0
            .id,
        user.id
    );
    assert_eq!(db.quota(&user.id).unwrap().remaining_tokens, 100);
}

#[test]
fn revoked_expired_and_spent_invites_cannot_register() {
    let db = Accounts::open(Path::new(":memory:"), vec![]).unwrap();
    let revoked = invite(&db, None, 100);
    db.revoke_invite(revoked["id"].as_str().unwrap()).unwrap();
    assert!(
        db.authenticate("a@example.com", "a-test-password", revoked["code"].as_str())
            .is_err()
    );
    let expired = invite(&db, None, 100);
    db.0.lock()
        .unwrap()
        .execute(
            "UPDATE invites SET expires_at=0 WHERE id=?1",
            [expired["id"].as_str().unwrap()],
        )
        .unwrap();
    assert!(
        db.authenticate("a@example.com", "a-test-password", expired["code"].as_str())
            .is_err()
    );
    let one = invite(&db, None, 100);
    db.authenticate("a@example.com", "a-test-password", one["code"].as_str())
        .unwrap();
    assert!(
        db.authenticate("b@example.com", "a-test-password", one["code"].as_str())
            .is_err()
    );
}

#[test]
fn legacy_accounts_and_admin_emails_require_a_bound_invite() {
    let db = Accounts::open(Path::new(":memory:"), vec!["admin@example.com".into()]).unwrap();
    let (legacy, session) = db.login("old@example.com").unwrap();
    db.0.lock()
        .unwrap()
        .execute(
            "UPDATE account_access SET password_hash=NULL WHERE user_id=?1",
            [&legacy.id],
        )
        .unwrap();
    assert!(db.session(&session).is_none());
    let generic = invite(&db, None, 100);
    assert!(
        db.authenticate(
            "old@example.com",
            "a-test-password",
            generic["code"].as_str()
        )
        .is_err()
    );
    assert!(
        db.authenticate(
            "admin@example.com",
            "a-test-password",
            generic["code"].as_str()
        )
        .is_err()
    );
    let (activated, _) = register(&db, "old@example.com", 100);
    assert_eq!(activated.id, legacy.id);
    assert!(register(&db, "admin@example.com", 100).0.is_admin);
}

#[test]
fn concurrent_invite_redemption_has_only_one_winner() {
    let db = Accounts::open(Path::new(":memory:"), vec![]).unwrap();
    let invitation = invite(&db, None, 100);
    let handles = (0..2)
        .map(|i| {
            let db = db.clone();
            let code = invitation["code"].as_str().unwrap().to_owned();
            std::thread::spawn(move || {
                db.authenticate(
                    &format!("user{i}@example.com"),
                    "a-test-password",
                    Some(&code),
                )
                .is_ok()
            })
        })
        .collect::<Vec<_>>();
    assert_eq!(
        handles
            .into_iter()
            .map(|h| usize::from(h.join().unwrap()))
            .sum::<usize>(),
        1
    );
}

#[test]
fn quota_reservations_settlement_unknowns_and_idempotent_topups() {
    let db = Accounts::open(Path::new(":memory:"), vec![]).unwrap();
    let (user, _) = register(&db, "a@example.com", 100);
    let mut charge = db.reserve_model(&user.id).unwrap();
    assert!(db.reserve_model(&user.id).is_err());
    assert_eq!(db.quota(&user.id).unwrap().reserved_tokens, 100);
    charge.settle(Some(30), 0).unwrap();
    charge.settle(Some(30), 0).unwrap();
    assert_eq!(db.quota(&user.id).unwrap().remaining_tokens, 70);
    drop(db.reserve_model(&user.id).unwrap());
    assert_eq!(db.quota(&user.id).unwrap().remaining_tokens, 70);
    let mut interrupted = db.reserve_model(&user.id).unwrap();
    interrupted.mark_sent();
    drop(interrupted);
    assert_eq!(db.quota(&user.id).unwrap().remaining_tokens, 0);
    assert_eq!(db.quota(&user.id).unwrap().unknown_calls, 1);
    let id = Uuid::new_v4().to_string();
    db.update_account("admin", &user.id, 50, 1, None, &id)
        .unwrap();
    db.update_account("admin", &user.id, 50, 1, None, &id)
        .unwrap();
    assert_eq!(db.quota(&user.id).unwrap().remaining_tokens, 50);
    assert_eq!(db.quota(&user.id).unwrap().media_limit, 3);
}

#[test]
fn disabling_revokes_sessions_and_blocks_internal_work_without_deleting_usage() {
    let db = Accounts::open(Path::new(":memory:"), vec![]).unwrap();
    let (user, session) = register(&db, "a@example.com", 100);
    db.consume_media(&user.id).unwrap();
    db.consume_media(&user.id).unwrap();
    assert!(db.consume_media(&user.id).is_err());
    db.update_account(
        "admin",
        &user.id,
        0,
        0,
        Some(true),
        &Uuid::new_v4().to_string(),
    )
    .unwrap();
    assert!(db.session(&session).is_none());
    assert!(db.check_quota(&user.id).is_err());
    assert!(db.reserve_model(&user.id).is_err());
    assert_eq!(db.quota(&user.id).unwrap().used_media, 2);
    assert!(
        db.authenticate("a@example.com", "a-test-password", None)
            .is_err()
    );
}

#[test]
fn reopening_does_not_settle_live_reservations_but_recovery_does_once() {
    let path = std::env::temp_dir().join(format!("yingya-quota-{}.sqlite", Uuid::new_v4()));
    let db = Accounts::open(&path, vec![]).unwrap();
    let (user, _) = register(&db, "a@example.com", 100);
    let mut charge = db.reserve_model(&user.id).unwrap();
    charge.mark_sent();
    let reopened = Accounts::open(&path, vec![]).unwrap();
    assert_eq!(reopened.quota(&user.id).unwrap().reserved_tokens, 100);
    reopened.recover_accounting().unwrap();
    reopened.recover_accounting().unwrap();
    drop(charge);
    assert_eq!(reopened.quota(&user.id).unwrap().used_tokens, 100);
    drop(reopened);
    drop(db);
    let _ = std::fs::remove_file(path);
}
