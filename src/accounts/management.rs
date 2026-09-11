use super::access::{email, password_hash, quota};
use super::*;
use argon2::{Argon2, PasswordHash, PasswordVerifier};

pub(super) fn migrate(db: &Connection) -> Result<(), String> {
    db.execute_batch("CREATE TABLE IF NOT EXISTS user_profiles(user_id TEXT PRIMARY KEY REFERENCES users(id),username TEXT UNIQUE,name TEXT NOT NULL DEFAULT '',notes TEXT NOT NULL DEFAULT '',archived INTEGER NOT NULL DEFAULT 0,last_login INTEGER);
      INSERT OR IGNORE INTO user_profiles(user_id) SELECT id FROM users;
      CREATE TABLE IF NOT EXISTS admin_audit(id TEXT PRIMARY KEY,actor TEXT NOT NULL,action TEXT NOT NULL,target TEXT NOT NULL,details TEXT NOT NULL,created_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS invite_details(invite_id TEXT PRIMARY KEY REFERENCES invites(id),label TEXT NOT NULL DEFAULT '');
      CREATE TABLE IF NOT EXISTS invite_redemptions(invite_id TEXT NOT NULL REFERENCES invites(id),user_id TEXT NOT NULL REFERENCES users(id),created_at INTEGER NOT NULL,PRIMARY KEY(invite_id,user_id));
      CREATE TABLE IF NOT EXISTS admin_revisions(kind TEXT NOT NULL,target TEXT NOT NULL,revision INTEGER NOT NULL,PRIMARY KEY(kind,target));")
        .map_err(|e|e.to_string())
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ManagedUserInput {
    pub email: String,
    pub username: String,
    pub name: String,
    pub password: String,
    pub is_admin: bool,
    pub token_limit: i64,
    pub media_limit: i64,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProfileUpdate {
    pub revision: i64,
    pub email: String,
    pub username: String,
    pub name: String,
    pub notes: String,
    pub is_admin: bool,
    pub status: String,
    pub token_limit: i64,
    pub media_limit: i64,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct InviteUpdate {
    pub revision: i64,
    pub label: String,
    pub email: Option<String>,
    pub expires_at: i64,
    pub max_uses: i64,
    pub token_limit: i64,
    pub media_limit: i64,
    pub revoked: bool,
}

fn username(raw: &str) -> Result<Option<String>, String> {
    let value = raw.trim().to_lowercase();
    if value.is_empty() {
        return Ok(None);
    }
    if !(3..=32).contains(&value.len())
        || !value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"_.-".contains(&b))
    {
        return Err("用户名需要 3 至 32 位字母、数字、下划线、点或短横线".into());
    }
    Ok(Some(value))
}
fn limits(tokens: i64, media: i64) -> Result<(), String> {
    if !(0..=1_000_000_000_000).contains(&tokens) || !(0..=1_000_000).contains(&media) {
        return Err("额度超出允许范围".into());
    }
    Ok(())
}
fn revision(db: &Connection, kind: &str, id: &str) -> Result<i64, String> {
    db.query_row(
        "SELECT revision FROM admin_revisions WHERE kind=?1 AND target=?2",
        params![kind, id],
        |r| r.get(0),
    )
    .optional()
    .map(|value| value.unwrap_or(0))
    .map_err(|e| e.to_string())
}
pub(super) fn bump_revision(db: &Connection, kind: &str, id: &str) -> Result<(), String> {
    db.execute("INSERT INTO admin_revisions VALUES(?1,?2,1) ON CONFLICT(kind,target) DO UPDATE SET revision=revision+1",params![kind,id]).map_err(|e|e.to_string())?;
    Ok(())
}
fn check_revision(db: &Connection, kind: &str, id: &str, expected: i64) -> Result<(), String> {
    if revision(db, kind, id)? != expected {
        return Err("记录已被其他操作更新，请关闭详情并刷新后重试".into());
    }
    bump_revision(db, kind, id)
}
pub(super) fn audit(
    db: &Connection,
    actor: &str,
    action: &str,
    target: &str,
    details: Value,
) -> Result<(), String> {
    db.execute(
        "INSERT INTO admin_audit VALUES(?1,?2,?3,?4,?5,?6)",
        params![
            Uuid::new_v4().to_string(),
            actor,
            action,
            target,
            details.to_string(),
            now()
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

impl Accounts {
    pub fn upgrade_default_quotas(&self) -> Result<Value, String> {
        let mut db = self.0.lock().map_err(|e| e.to_string())?;
        let tx = db.transaction().map_err(|e| e.to_string())?;
        let targets = {
            let mut statement = tx.prepare(
                "SELECT 'user',user_id FROM account_access WHERE token_limit=1000000 AND media_limit=20
                 UNION ALL SELECT 'invite',id FROM invites WHERE token_limit=1000000 AND media_limit=20",
            ).map_err(|e| e.to_string())?;
            statement
                .query_map([], |row| {
                    Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
                })
                .map_err(|e| e.to_string())?
                .collect::<Result<Vec<_>, _>>()
                .map_err(|e| e.to_string())?
        };
        let mut users = 0;
        let mut invites = 0;
        for (kind, id) in targets {
            let sql = if kind == "user" {
                users += 1;
                "UPDATE account_access SET token_limit=?2,media_limit=?3 WHERE user_id=?1"
            } else {
                invites += 1;
                "UPDATE invites SET token_limit=?2,media_limit=?3 WHERE id=?1"
            };
            tx.execute(sql, params![id, DEFAULT_TOKEN_LIMIT, DEFAULT_MEDIA_LIMIT])
                .map_err(|e| e.to_string())?;
            bump_revision(&tx, &kind, &id)?;
            audit(
                &tx,
                "宿主终端",
                "提高旧默认额度",
                &id,
                json!({
                    "before": {"tokenLimit": 1_000_000, "mediaLimit": 20},
                    "after": {"tokenLimit": DEFAULT_TOKEN_LIMIT, "mediaLimit": DEFAULT_MEDIA_LIMIT},
                }),
            )?;
        }
        tx.commit().map_err(|e| e.to_string())?;
        Ok(json!({"users": users, "invites": invites}))
    }

    pub fn change_own_password(&self, id: &str, current: &str, new: &str) -> Result<(), String> {
        if current.len() > 512 {
            return Err("当前密码不正确".into());
        }
        let hash = password_hash(new)?;
        let saved: String = self
            .0
            .lock()
            .map_err(|e| e.to_string())?
            .query_row(
                "SELECT password_hash FROM account_access WHERE user_id=?1 AND disabled=0",
                [id],
                |r| r.get(0),
            )
            .map_err(|_| "账号不可用")?;
        let parsed = PasswordHash::new(&saved).map_err(|_| "当前密码不可用")?;
        Argon2::default()
            .verify_password(current.as_bytes(), &parsed)
            .map_err(|_| "当前密码不正确")?;
        let mut db = self.0.lock().map_err(|e| e.to_string())?;
        let tx = db.transaction().map_err(|e| e.to_string())?;
        if tx.execute("UPDATE account_access SET password_hash=?2 WHERE user_id=?1 AND password_hash=?3 AND disabled=0",params![id,hash,saved]).map_err(|e|e.to_string())?!=1{return Err("账号已改变，请重新登录".into());}
        tx.execute("DELETE FROM sessions WHERE user_id=?1", [id])
            .map_err(|e| e.to_string())?;
        tx.execute("DELETE FROM password_resets WHERE user_id=?1", [id])
            .map_err(|e| e.to_string())?;
        audit(&tx, id, "修改登录密码", id, json!({}))?;
        tx.commit().map_err(|e| e.to_string())
    }
    pub fn admin_login(&self, raw_email: &str, password: &str) -> Result<(User, String), String> {
        let (user, token) = self
            .authenticate(raw_email, password, None)
            .map_err(|_| "邮箱或密码不正确或账号暂不可用")?;
        if !user.is_admin {
            self.logout(&token)?;
            return Err("该账号没有管理权限".into());
        }
        Ok((user, token))
    }

    pub fn create_managed_user(
        &self,
        actor: &str,
        input: ManagedUserInput,
    ) -> Result<Value, String> {
        let mail = email(&input.email)?;
        let login = username(&input.username)?;
        if !input.is_admin && self.1.contains(&mail) {
            return Err("该邮箱被配置为管理员，不能创建为普通用户".into());
        }
        limits(input.token_limit, input.media_limit)?;
        if input.name.chars().count() > 100 {
            return Err("姓名最多 100 个字符".into());
        }
        let hash = password_hash(&input.password)?;
        let mut db = self.0.lock().map_err(|e| e.to_string())?;
        let tx = db.transaction().map_err(|e| e.to_string())?;
        if tx.query_row("SELECT 1 FROM users WHERE email=?1 UNION ALL SELECT 1 FROM user_profiles WHERE username=?2",params![mail,login],|_|Ok(())).optional().map_err(|e|e.to_string())?.is_some(){return Err("邮箱或用户名已存在".into());}
        let id = Uuid::new_v4().to_string();
        tx.execute(
            "INSERT INTO users VALUES(?1,?2,?3)",
            params![id, mail, now()],
        )
        .map_err(|e| e.to_string())?;
        tx.execute("INSERT INTO account_access(user_id,password_hash,admin,token_limit,media_limit) VALUES(?1,?2,?3,?4,?5)",params![id,hash,input.is_admin,input.token_limit,input.media_limit]).map_err(|e|e.to_string())?;
        tx.execute(
            "INSERT INTO user_profiles(user_id,username,name) VALUES(?1,?2,?3)",
            params![id, login, input.name.trim()],
        )
        .map_err(|e| e.to_string())?;
        audit(
            &tx,
            actor,
            "创建用户",
            &id,
            json!({"email":mail,"username":login,"isAdmin":input.is_admin,"tokenLimit":input.token_limit,"mediaLimit":input.media_limit}),
        )?;
        tx.commit().map_err(|e| e.to_string())?;
        Ok(json!({"id":id}))
    }

    pub fn managed_users(&self) -> Result<Value, String> {
        let db = self.0.lock().map_err(|e| e.to_string())?;
        let mut stmt=db.prepare("SELECT u.id,u.email,u.created_at,a.password_hash IS NOT NULL,a.admin,p.username,COALESCE(p.name,''),COALESCE(p.notes,''),COALESCE(p.archived,0),p.last_login FROM users u JOIN account_access a ON a.user_id=u.id LEFT JOIN user_profiles p ON p.user_id=u.id ORDER BY u.created_at DESC,u.email").map_err(|e|e.to_string())?;
        let rows = stmt
            .query_map([], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, i64>(2)?,
                    r.get::<_, bool>(3)?,
                    r.get::<_, bool>(4)?,
                    r.get::<_, Option<String>>(5)?,
                    r.get::<_, String>(6)?,
                    r.get::<_, String>(7)?,
                    r.get::<_, bool>(8)?,
                    r.get::<_, Option<i64>>(9)?,
                ))
            })
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        let users=rows.into_iter().map(|(id,email,created,registered,admin,username,name,notes,archived,last_login)|Ok(json!({"id":id,"email":email,"createdAt":created,"registered":registered,"isAdmin":admin||self.1.contains(&email),"configuredAdmin":self.1.contains(&email),"username":username,"name":name,"notes":notes,"archived":archived,"lastLogin":last_login,"revision":revision(&db,"user",&id)?,"quota":quota(&db,&id)?}))).collect::<Result<Vec<_>,String>>()?;
        Ok(json!({"users":users}))
    }

    pub fn edit_profile(&self, actor: &str, id: &str, input: ProfileUpdate) -> Result<(), String> {
        let mail = email(&input.email)?;
        let login = username(&input.username)?;
        limits(input.token_limit, input.media_limit)?;
        if input.name.chars().count() > 100 || input.notes.chars().count() > 2000 {
            return Err("姓名或备注过长".into());
        }
        if !matches!(input.status.as_str(), "active" | "disabled" | "archived") {
            return Err("账号状态无效".into());
        }
        if actor == id && (!input.is_admin || input.status != "active") {
            return Err("不能停用、归档或降级当前管理员".into());
        }
        let mut db = self.0.lock().map_err(|e| e.to_string())?;
        let tx = db.transaction().map_err(|e| e.to_string())?;
        let old: (String,bool)=tx.query_row("SELECT u.email,a.admin FROM users u JOIN account_access a ON a.user_id=u.id WHERE u.id=?1",[id],|r|Ok((r.get(0)?,r.get(1)?))).map_err(|_|"用户不存在")?;
        check_revision(&tx, "user", id, input.revision)?;
        if self.1.contains(&old.0) && (mail != old.0 || !input.is_admin) {
            return Err("此管理员由服务配置指定，不能修改邮箱或降级".into());
        }
        if mail != old.0 && self.1.contains(&mail) {
            return Err("该邮箱被服务配置保留为管理员".into());
        }
        if tx.query_row("SELECT 1 FROM users WHERE email=?1 AND id<>?3 UNION ALL SELECT 1 FROM user_profiles WHERE username=?2 AND user_id<>?3",params![mail,login,id],|_|Ok(())).optional().map_err(|e|e.to_string())?.is_some(){return Err("邮箱或用户名已存在".into());}
        let old_profile: Option<String> = tx
            .query_row(
                "SELECT username FROM user_profiles WHERE user_id=?1",
                [id],
                |r| r.get(0),
            )
            .optional()
            .map_err(|e| e.to_string())?
            .flatten();
        let q = quota(&tx, id)?;
        if input.token_limit < q.used_tokens + q.reserved_tokens
            || input.media_limit < q.used_media + q.reserved_media
        {
            return Err("总额度不能低于已用额度与运行中的预留额度之和".into());
        }
        let before = json!({"email":old.0,"username":old_profile,"isAdmin":old.1||self.1.contains(&old.0),"tokenLimit":q.token_limit,"mediaLimit":q.media_limit,"disabled":q.disabled});
        tx.execute("UPDATE users SET email=?2 WHERE id=?1", params![id, mail])
            .map_err(|e| e.to_string())?;
        tx.execute("UPDATE account_access SET admin=?2,disabled=?3,token_limit=?4,media_limit=?5 WHERE user_id=?1",params![id,input.is_admin,input.status!="active",input.token_limit,input.media_limit]).map_err(|e|e.to_string())?;
        tx.execute("INSERT INTO user_profiles(user_id,username,name,notes,archived) VALUES(?1,?2,?3,?4,?5) ON CONFLICT(user_id) DO UPDATE SET username=excluded.username,name=excluded.name,notes=excluded.notes,archived=excluded.archived",params![id,login,input.name.trim(),input.notes.trim(),input.status=="archived"]).map_err(|e|e.to_string())?;
        if input.status != "active"
            || mail != old.0
            || old_profile != login
            || old.1 != input.is_admin
        {
            tx.execute("DELETE FROM sessions WHERE user_id=?1", [id])
                .map_err(|e| e.to_string())?;
            tx.execute("DELETE FROM password_resets WHERE user_id=?1", [id])
                .map_err(|e| e.to_string())?;
        }
        audit(
            &tx,
            actor,
            "编辑用户",
            id,
            json!({"before":before,"after":{"email":mail,"username":login,"name":input.name.trim(),"isAdmin":input.is_admin,"status":input.status,"tokenLimit":input.token_limit,"mediaLimit":input.media_limit}}),
        )?;
        tx.commit().map_err(|e| e.to_string())
    }

    pub fn managed_invites(&self) -> Result<Value, String> {
        let mut value = self.list_invites()?;
        let db = self.0.lock().map_err(|e| e.to_string())?;
        if let Some(rows) = value["invites"].as_array_mut() {
            for row in rows {
                let id = row["id"].as_str().unwrap_or_default().to_owned();
                row["revision"] = json!(revision(&db, "invite", &id)?);
                row["label"] = json!(
                    db.query_row(
                        "SELECT label FROM invite_details WHERE invite_id=?1",
                        [&id],
                        |r| r.get::<_, String>(0)
                    )
                    .optional()
                    .map_err(|e| e.to_string())?
                    .unwrap_or_default()
                );
                row["admin"] = json!(
                    db.query_row("SELECT admin FROM invites WHERE id=?1", [&id], |r| r
                        .get::<_, bool>(0))
                        .map_err(|e| e.to_string())?
                );
                let mut stmt=db.prepare("SELECT u.id,u.email,r.created_at FROM invite_redemptions r JOIN users u ON u.id=r.user_id WHERE r.invite_id=?1 ORDER BY r.created_at DESC").map_err(|e|e.to_string())?;
                row["users"]=json!(stmt.query_map([&id],|r|Ok(json!({"id":r.get::<_,String>(0)?,"email":r.get::<_,String>(1)?,"createdAt":r.get::<_,i64>(2)?}))).map_err(|e|e.to_string())?.collect::<Result<Vec<_>,_>>().map_err(|e|e.to_string())?);
            }
        }
        Ok(value)
    }
    pub fn edit_invite(&self, actor: &str, id: &str, input: InviteUpdate) -> Result<(), String> {
        limits(input.token_limit, input.media_limit)?;
        let mail = input
            .email
            .as_deref()
            .filter(|s| !s.trim().is_empty())
            .map(email)
            .transpose()?;
        if input.label.chars().count() > 100
            || !(1..=1000).contains(&input.max_uses)
            || input.expires_at < 0
            || input.expires_at > now() + 365 * 86400
        {
            return Err("邀请名称、次数或到期时间无效".into());
        }
        let mut db = self.0.lock().map_err(|e| e.to_string())?;
        let tx = db.transaction().map_err(|e| e.to_string())?;
        let (uses,is_admin,previous):(i64,bool,String)=tx.query_row("SELECT uses,admin,json_object('email',email,'tokenLimit',token_limit,'mediaLimit',media_limit,'maxUses',max_uses,'expiresAt',expires_at,'revoked',revoked) FROM invites WHERE id=?1",[id],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?))).map_err(|_|"邀请不存在")?;
        check_revision(&tx, "invite", id, input.revision)?;
        if input.max_uses < uses {
            return Err("可使用次数不能少于已兑换次数".into());
        }
        if is_admin && (mail.is_none() || input.max_uses != 1) {
            return Err("管理员邀请必须绑定邮箱且仅可使用一次".into());
        }
        tx.execute("UPDATE invites SET email=?2,expires_at=?3,max_uses=?4,token_limit=?5,media_limit=?6,revoked=?7 WHERE id=?1",params![id,mail,input.expires_at,input.max_uses,input.token_limit,input.media_limit,input.revoked]).map_err(|e|e.to_string())?;
        tx.execute("INSERT INTO invite_details VALUES(?1,?2) ON CONFLICT(invite_id) DO UPDATE SET label=excluded.label",params![id,input.label.trim()]).map_err(|e|e.to_string())?;
        audit(
            &tx,
            actor,
            "编辑邀请",
            id,
            json!({"before":serde_json::from_str::<Value>(&previous).map_err(|e|e.to_string())?,"after":{"label":input.label.trim(),"email":mail,"expiresAt":input.expires_at,"maxUses":input.max_uses,"tokenLimit":input.token_limit,"mediaLimit":input.media_limit,"revoked":input.revoked}}),
        )?;
        tx.commit().map_err(|e| e.to_string())
    }
    pub fn record_admin_action(
        &self,
        actor: &str,
        action: &str,
        target: &str,
        details: Value,
    ) -> Result<(), String> {
        let db = self.0.lock().map_err(|e| e.to_string())?;
        audit(&db, actor, action, target, details)
    }
    pub fn audit_log(&self) -> Result<Value, String> {
        let db = self.0.lock().map_err(|e| e.to_string())?;
        let mut stmt=db.prepare("SELECT a.id,COALESCE(u.email,a.actor),a.action,a.target,a.details,a.created_at,COALESCE(t.email,NULLIF(d.label,''),a.target) FROM admin_audit a LEFT JOIN users u ON u.id=a.actor LEFT JOIN users t ON t.id=a.target LEFT JOIN invite_details d ON d.invite_id=a.target ORDER BY a.created_at DESC,a.rowid DESC LIMIT 500").map_err(|e|e.to_string())?;
        let records=stmt.query_map([],|r|Ok(json!({"id":r.get::<_,String>(0)?,"actor":r.get::<_,String>(1)?,"action":r.get::<_,String>(2)?,"target":r.get::<_,String>(3)?,"details":r.get::<_,String>(4)?,"createdAt":r.get::<_,i64>(5)?,"targetName":r.get::<_,String>(6)?}))).map_err(|e|e.to_string())?.collect::<Result<Vec<_>,_>>().map_err(|e|e.to_string())?;
        Ok(json!({"records":records}))
    }
    pub fn revoke_user_sessions(&self, actor: &str, id: &str) -> Result<(), String> {
        let mut db = self.0.lock().map_err(|e| e.to_string())?;
        let tx = db.transaction().map_err(|e| e.to_string())?;
        tx.execute("DELETE FROM sessions WHERE user_id=?1", [id])
            .map_err(|e| e.to_string())?;
        audit(&tx, actor, "撤销登录会话", id, json!({}))?;
        tx.commit().map_err(|e| e.to_string())
    }
}
