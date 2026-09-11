use super::*;

fn input(name: &str, admin: bool) -> ManagedUserInput {
    ManagedUserInput {
        email: format!("{name}@example.test"),
        username: name.into(),
        name: name.into(),
        password: "valid-test-password".into(),
        is_admin: admin,
        token_limit: 1000,
        media_limit: 10,
    }
}
fn create(db: &Accounts, name: &str, admin: bool) -> String {
    db.create_managed_user("host", input(name, admin)).unwrap()["id"]
        .as_str()
        .unwrap()
        .to_owned()
}
fn profile(db: &Accounts, id: &str) -> ProfileUpdate {
    let all = db.managed_users().unwrap();
    let user = all["users"]
        .as_array()
        .unwrap()
        .iter()
        .find(|user| user["id"] == id)
        .unwrap();
    ProfileUpdate {
        revision: user["revision"].as_i64().unwrap(),
        email: user["email"].as_str().unwrap().into(),
        username: user["username"].as_str().unwrap_or("").into(),
        name: user["name"].as_str().unwrap().into(),
        notes: user["notes"].as_str().unwrap().into(),
        is_admin: user["isAdmin"].as_bool().unwrap(),
        status: if user["archived"] == true {
            "archived"
        } else if user["quota"]["disabled"] == true {
            "disabled"
        } else {
            "active"
        }
        .into(),
        token_limit: user["quota"]["tokenLimit"].as_i64().unwrap(),
        media_limit: user["quota"]["mediaLimit"].as_i64().unwrap(),
    }
}

#[test]
fn default_quota_upgrade_preserves_custom_limits_usage_sessions_and_revisions() {
    let db = Accounts::open(Path::new(":memory:"), vec![]).unwrap();
    let mut original = input("original", true);
    original.token_limit = 1_000_000;
    original.media_limit = 20;
    let id = db.create_managed_user("host", original).unwrap()["id"]
        .as_str()
        .unwrap()
        .to_owned();
    let (_, session) = db
        .admin_login("original@example.test", "valid-test-password")
        .unwrap();
    let stale = profile(&db, &id);
    db.0.lock()
        .unwrap()
        .execute(
            "UPDATE account_access SET used_tokens=1234,used_media=3 WHERE user_id=?1",
            [&id],
        )
        .unwrap();
    let charge = db.reserve_model(&id).unwrap();
    assert!(charge.reserve_image().unwrap());
    let before = db.quota(&id).unwrap();
    let mut custom = input("custom", false);
    custom.token_limit = 2_000_000;
    custom.media_limit = 20;
    let custom_id = db.create_managed_user("host", custom).unwrap()["id"]
        .as_str()
        .unwrap()
        .to_owned();
    let invite = db
        .invite(
            InviteInput {
                email: None,
                expires_in_days: 7,
                max_uses: 2,
                token_limit: 1_000_000,
                media_limit: 20,
            },
            false,
        )
        .unwrap();
    db.invite(
        InviteInput {
            email: None,
            expires_in_days: 7,
            max_uses: 1,
            token_limit: 1_000_000,
            media_limit: 60,
        },
        false,
    )
    .unwrap();
    assert_eq!(
        db.upgrade_default_quotas().unwrap(),
        json!({"users": 1, "invites": 1})
    );
    let after = db.quota(&id).unwrap();
    assert_eq!((after.token_limit, after.media_limit), (1_000_000_000, 40));
    assert_eq!(
        (after.used_tokens, after.used_media, after.reserved_tokens),
        (
            before.used_tokens,
            before.used_media,
            before.reserved_tokens
        )
    );
    assert_eq!(after.reserved_media, before.reserved_media);
    assert_eq!(db.quota(&custom_id).unwrap().token_limit, 2_000_000);
    assert!(db.session(&session).is_some());
    assert!(db.edit_profile(&id, &id, stale).is_err());
    let all = db.managed_invites().unwrap();
    let upgraded = all["invites"]
        .as_array()
        .unwrap()
        .iter()
        .find(|row| row["id"] == invite["id"])
        .unwrap();
    assert_eq!(upgraded["tokenLimit"], 1_000_000_000);
    assert_eq!(upgraded["mediaLimit"], 40);
    assert_eq!(upgraded["revision"], 1);
    assert_eq!(
        db.upgrade_default_quotas().unwrap(),
        json!({"users": 0, "invites": 0})
    );
    assert_eq!(
        db.audit_log().unwrap()["records"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|row| row["action"] == "提高旧默认额度")
            .count(),
        2
    );
    drop(charge);
}

#[test]
fn admin_requires_email_password_and_role() {
    let db = Accounts::open(Path::new(":memory:"), vec![]).unwrap();
    let owner = create(&db, "owner", true);
    create(&db, "member", false);
    assert_eq!(
        db.admin_login(" OWNER@EXAMPLE.TEST ", "valid-test-password")
            .unwrap()
            .0
            .id,
        owner
    );
    assert!(
        db.admin_login("owner@example.test", "wrong-password")
            .is_err()
    );
    assert!(
        db.admin_login("member@example.test", "valid-test-password")
            .is_err()
    );
    assert!(
        db.admin_login("absent@example.test", "valid-test-password")
            .is_err()
    );
    let mut duplicate = input("another", false);
    duplicate.username = "OWNER".into();
    assert!(db.create_managed_user("host", duplicate).is_err());
    let records = db.audit_log().unwrap().to_string();
    assert!(!records.contains("valid-test-password"));
    assert!(db.admin_login("owner", "valid-test-password").is_err());
    let mut email_only = input("email-only", true);
    email_only.username.clear();
    db.create_managed_user("host", email_only).unwrap();
    assert!(
        db.admin_login("email-only@example.test", "valid-test-password")
            .is_ok()
    );
    let mut edit = profile(&db, &owner);
    edit.username.clear();
    db.edit_profile(&owner, &owner, edit).unwrap();
    assert!(
        db.admin_login("owner@example.test", "valid-test-password")
            .is_ok()
    );
}

#[test]
fn user_editing_preserves_identity_and_rejects_stale_writes() {
    let db = Accounts::open(Path::new(":memory:"), vec![]).unwrap();
    let owner = create(&db, "owner", true);
    let member = create(&db, "member", false);
    let (_, token) = db
        .authenticate("member@example.test", "valid-test-password", None)
        .unwrap();
    db.request(&member, "request", "agent").unwrap();
    let stale = profile(&db, &member);
    let mut edit = profile(&db, &member);
    edit.name = "新名字".into();
    edit.notes = "内测用户".into();
    edit.token_limit = 2000;
    db.edit_profile(&owner, &member, edit).unwrap();
    assert!(db.edit_profile(&owner, &member, stale).is_err());
    assert_eq!(db.quota(&member).unwrap().token_limit, 2000);
    assert!(db.session(&token).is_some());
    let mut edit = profile(&db, &member);
    edit.status = "archived".into();
    db.edit_profile(&owner, &member, edit).unwrap();
    assert!(db.session(&token).is_none());
    assert!(
        db.authenticate("member@example.test", "valid-test-password", None)
            .is_err()
    );
    let mut edit = profile(&db, &member);
    edit.status = "active".into();
    db.edit_profile(&owner, &member, edit).unwrap();
    assert_eq!(
        db.authenticate("member@example.test", "valid-test-password", None)
            .unwrap()
            .0
            .id,
        member
    );
    assert_eq!(
        db.usage(Some(&member), 0, now() + 1, None).unwrap()["users"][0]["requests"],
        1
    );
}

#[test]
fn roles_reserved_emails_and_inflight_quotas_cannot_be_overwritten() {
    let db = Accounts::open(Path::new(":memory:"), vec!["owner@example.test".into()]).unwrap();
    let owner = create(&db, "owner", true);
    let member = create(&db, "member", false);
    let mut edit = profile(&db, &owner);
    edit.is_admin = false;
    assert!(db.edit_profile(&owner, &owner, edit).is_err());
    let mut edit = profile(&db, &owner);
    edit.status = "disabled".into();
    assert!(db.edit_profile(&owner, &owner, edit).is_err());
    let mut edit = profile(&db, &member);
    edit.email = "owner@example.test".into();
    assert!(db.edit_profile(&owner, &member, edit).is_err());
    let charge = db.reserve_model(&member).unwrap();
    let mut edit = profile(&db, &member);
    edit.token_limit = 10;
    assert!(db.edit_profile(&owner, &member, edit).is_err());
    drop(charge);
    let mut edit = profile(&db, &member);
    edit.is_admin = true;
    db.edit_profile(&owner, &member, edit).unwrap();
    assert!(
        db.admin_login("member@example.test", "valid-test-password")
            .unwrap()
            .0
            .is_admin
    );
}

#[test]
fn invitation_changes_only_apply_to_future_redemptions() {
    let db = Accounts::open(Path::new(":memory:"), vec![]).unwrap();
    let owner = create(&db, "owner", true);
    let invite = db
        .invite(
            InviteInput {
                email: None,
                expires_in_days: 7,
                max_uses: 2,
                token_limit: 100,
                media_limit: 1,
            },
            false,
        )
        .unwrap();
    let id = invite["id"].as_str().unwrap();
    let code = invite["code"].as_str();
    let (first, _) = db
        .authenticate("first@example.test", "valid-test-password", code)
        .unwrap();
    let update = |revision, uses| InviteUpdate {
        revision,
        label: "第二批内测".into(),
        email: None,
        expires_at: now() + 86400,
        max_uses: uses,
        token_limit: 500,
        media_limit: 3,
        revoked: false,
    };
    db.edit_invite(&owner, id, update(0, 2)).unwrap();
    assert!(db.edit_invite(&owner, id, update(0, 3)).is_err());
    let (second, _) = db
        .authenticate("second@example.test", "valid-test-password", code)
        .unwrap();
    assert_eq!(db.quota(&first.id).unwrap().remaining_tokens, 100);
    assert_eq!(db.quota(&second.id).unwrap().remaining_tokens, 500);
    assert!(db.edit_invite(&owner, id, update(1, 1)).is_err());
    let result = db.managed_invites().unwrap();
    assert_eq!(result["invites"][0]["users"].as_array().unwrap().len(), 2);
    assert_eq!(result["invites"][0]["label"], "第二批内测");
}

#[test]
fn password_change_requires_current_password_and_revokes_every_session() {
    let db = Accounts::open(Path::new(":memory:"), vec![]).unwrap();
    let owner = create(&db, "owner", true);
    let (_, session) = db
        .admin_login("owner@example.test", "valid-test-password")
        .unwrap();
    assert!(
        db.change_own_password(&owner, "wrong-password", "new-test-password")
            .is_err()
    );
    assert!(db.session(&session).is_some());
    db.change_own_password(&owner, "valid-test-password", "new-test-password")
        .unwrap();
    assert!(db.session(&session).is_none());
    assert!(
        db.admin_login("owner@example.test", "valid-test-password")
            .is_err()
    );
    assert!(
        db.admin_login("owner@example.test", "new-test-password")
            .is_ok()
    );
    let records = db.audit_log().unwrap().to_string();
    assert!(!records.contains("new-test-password"));
}
