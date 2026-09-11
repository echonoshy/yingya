use super::*;
use argon2::{Argon2, PasswordHash, PasswordHasher, PasswordVerifier, password_hash::SaltString};

pub(super) fn migrate(db: &Connection) -> Result<(), String> {
    db.execute_batch("CREATE TABLE IF NOT EXISTS account_access(
      user_id TEXT PRIMARY KEY REFERENCES users(id), password_hash TEXT, admin INTEGER NOT NULL DEFAULT 0,
      disabled INTEGER NOT NULL DEFAULT 0, token_limit INTEGER NOT NULL DEFAULT 0, media_limit INTEGER NOT NULL DEFAULT 0,
      used_tokens INTEGER NOT NULL DEFAULT 0, used_media INTEGER NOT NULL DEFAULT 0);
      INSERT OR IGNORE INTO account_access(user_id,used_tokens) SELECT u.id,COALESCE(SUM(t.total),0) FROM users u LEFT JOIN turns t ON t.user_id=u.id GROUP BY u.id;
      CREATE TABLE IF NOT EXISTS invites(id TEXT PRIMARY KEY,hash TEXT UNIQUE NOT NULL,email TEXT,expires_at INTEGER NOT NULL,
      max_uses INTEGER NOT NULL,uses INTEGER NOT NULL DEFAULT 0,token_limit INTEGER NOT NULL,media_limit INTEGER NOT NULL,
      revoked INTEGER NOT NULL DEFAULT 0,admin INTEGER NOT NULL DEFAULT 0,created_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS account_changes(id TEXT PRIMARY KEY,user_id TEXT NOT NULL,actor TEXT NOT NULL,tokens INTEGER NOT NULL,media INTEGER NOT NULL,created_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS auth_attempts(key TEXT PRIMARY KEY,attempts INTEGER NOT NULL,window INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS password_resets(hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),expires_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS model_charges(id TEXT PRIMARY KEY,user_id TEXT NOT NULL,reserved INTEGER NOT NULL,tokens INTEGER,media INTEGER NOT NULL DEFAULT 0,status TEXT NOT NULL,created_at INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS charges_user_status ON model_charges(user_id,status);")
        .map_err(|e|e.to_string())
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct InviteInput {
    pub email: Option<String>,
    pub expires_in_days: i64,
    pub max_uses: i64,
    pub token_limit: i64,
    pub media_limit: i64,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Quota {
    pub token_limit: i64,
    pub used_tokens: i64,
    pub reserved_tokens: i64,
    pub remaining_tokens: i64,
    pub media_limit: i64,
    pub used_media: i64,
    pub remaining_media: i64,
    pub reserved_media: i64,
    pub unknown_calls: i64,
    pub disabled: bool,
}

pub(super) fn email(value: &str) -> Result<String, String> {
    let value = value.trim().to_lowercase();
    let parts: Vec<_> = value.split('@').collect();
    if value.len() > 254
        || parts.len() != 2
        || parts[0].is_empty()
        || !parts[1].contains('.')
        || parts[1].starts_with('.')
        || parts[1].ends_with('.')
        || value.chars().any(|c| c.is_whitespace() || c.is_control())
    {
        return Err("请输入有效的邮箱地址".into());
    }
    Ok(value)
}

pub(super) fn password_hash(password: &str) -> Result<String, String> {
    if !(10..=128).contains(&password.chars().count()) || password.len() > 512 {
        return Err("密码需要 10 至 128 个字符".into());
    }
    let salt = SaltString::encode_b64(Uuid::new_v4().as_bytes()).map_err(|e| e.to_string())?;
    Argon2::default()
        .hash_password(password.as_bytes(), &salt)
        .map(|h| h.to_string())
        .map_err(|e| e.to_string())
}

impl Accounts {
    pub fn password_reset(&self, raw_email: &str) -> Result<Value, String> {
        let email = email(raw_email)?;
        let mut db = self.0.lock().map_err(|e| e.to_string())?;
        let tx = db.transaction().map_err(|e| e.to_string())?;
        let id:String=tx.query_row("SELECT u.id FROM users u JOIN account_access a ON a.user_id=u.id WHERE u.email=?1 AND a.password_hash IS NOT NULL AND a.disabled=0",[&email],|r|r.get(0)).map_err(|_|"账号尚未激活或已停用")?;
        let code = secret();
        tx.execute(
            "DELETE FROM password_resets WHERE user_id=?1 OR expires_at<=?2",
            params![id, now()],
        )
        .map_err(|e| e.to_string())?;
        tx.execute(
            "INSERT INTO password_resets VALUES(?1,?2,?3)",
            params![digest(&code), id, now() + 3600],
        )
        .map_err(|e| e.to_string())?;
        tx.commit().map_err(|e| e.to_string())?;
        Ok(json!({"code":code,"email":email}))
    }
    pub fn reset_password(
        &self,
        raw_email: &str,
        password: &str,
        code: &str,
    ) -> Result<(), String> {
        let email = email(raw_email)?;
        self.auth_attempt(&email)?;
        let hash = password_hash(password)?;
        let mut db = self.0.lock().map_err(|e| e.to_string())?;
        let tx = db.transaction().map_err(|e| e.to_string())?;
        let id:String=tx.query_row("SELECT u.id FROM password_resets p JOIN users u ON u.id=p.user_id JOIN account_access a ON a.user_id=u.id WHERE p.hash=?1 AND p.expires_at>?2 AND u.email=?3 AND a.disabled=0",params![digest(code),now(),email],|r|r.get(0)).map_err(|_|"重置链接无效或已过期")?;
        tx.execute(
            "UPDATE account_access SET password_hash=?2 WHERE user_id=?1",
            params![id, hash],
        )
        .map_err(|e| e.to_string())?;
        tx.execute("DELETE FROM sessions WHERE user_id=?1", [&id])
            .map_err(|e| e.to_string())?;
        tx.execute("DELETE FROM password_resets WHERE user_id=?1", [&id])
            .map_err(|e| e.to_string())?;
        tx.execute("DELETE FROM auth_attempts WHERE key=?1", [digest(&email)])
            .map_err(|e| e.to_string())?;
        tx.commit().map_err(|e| e.to_string())
    }
    pub fn recover_accounting(&self) -> Result<(), String> {
        let mut db = self.0.lock().map_err(|e| e.to_string())?;
        let tx = db.transaction().map_err(|e| e.to_string())?;
        tx.execute_batch("UPDATE turns SET status='interrupted' WHERE status='running';
          UPDATE account_access SET used_tokens=used_tokens+COALESCE((SELECT SUM(reserved) FROM model_charges WHERE user_id=account_access.user_id AND status='running'),0),used_media=used_media+COALESCE((SELECT SUM(media) FROM model_charges WHERE user_id=account_access.user_id AND status='running'),0);
          UPDATE model_charges SET tokens=reserved,status='unknown' WHERE status='running';").map_err(|e|e.to_string())?;
        tx.commit().map_err(|e| e.to_string())
    }

    pub fn invite(&self, input: InviteInput, admin: bool) -> Result<Value, String> {
        if !(1..=365).contains(&input.expires_in_days)
            || !(1..=1000).contains(&input.max_uses)
            || !(0..=1_000_000_000_000).contains(&input.token_limit)
            || !(0..=1_000_000).contains(&input.media_limit)
        {
            return Err("邀请有效期、次数或额度超出允许范围".into());
        }
        let bound = input
            .email
            .as_deref()
            .filter(|s| !s.trim().is_empty())
            .map(email)
            .transpose()?;
        if admin && (bound.is_none() || input.max_uses != 1) {
            return Err("管理员邀请必须绑定邮箱且仅可使用一次".into());
        }
        let id = Uuid::new_v4().to_string();
        let code = secret();
        let expires = now() + input.expires_in_days * 86400;
        self.0.lock().map_err(|e|e.to_string())?.execute("INSERT INTO invites(id,hash,email,expires_at,max_uses,token_limit,media_limit,admin,created_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9)",params![id,digest(&code),bound,expires,input.max_uses,input.token_limit,input.media_limit,admin,now()]).map_err(|e|e.to_string())?;
        Ok(json!({"id":id,"code":code,"expiresAt":expires}))
    }

    pub fn authenticate(
        &self,
        raw_email: &str,
        password: &str,
        invite: Option<&str>,
    ) -> Result<(User, String), String> {
        let email = email(raw_email)?;
        if password.len() > 512 {
            return Err("邮箱或密码不正确".into());
        }
        self.auth_attempt(&email)?;
        if let Some(code) = invite {
            let hash = password_hash(password)?;
            let mut db = self.0.lock().map_err(|e| e.to_string())?;
            let tx = db.transaction().map_err(|e| e.to_string())?;
            let invitation=tx.query_row("SELECT id,email,token_limit,media_limit,admin FROM invites WHERE hash=?1 AND revoked=0 AND expires_at>?2 AND uses<max_uses",params![digest(code.trim()),now()],|r|Ok((r.get::<_,String>(0)?,r.get::<_,Option<String>>(1)?,r.get::<_,i64>(2)?,r.get::<_,i64>(3)?,r.get::<_,bool>(4)?))).optional().map_err(|e|e.to_string())?.ok_or("邀请码无效、已用完或已过期")?;
            if invitation.1.as_ref().is_some_and(|bound| bound != &email)
                || (self.1.contains(&email) && invitation.1.is_none())
            {
                return Err("邀请码与邮箱不匹配".into());
            }
            let existing=tx.query_row("SELECT u.id,a.password_hash FROM users u LEFT JOIN account_access a ON a.user_id=u.id WHERE u.email=?1",[&email],|r|Ok((r.get::<_,String>(0)?,r.get::<_,Option<String>>(1)?))).optional().map_err(|e|e.to_string())?;
            if existing.as_ref().is_some_and(|(_, hash)| hash.is_some()) {
                return Err("该邮箱已注册，请直接登录".into());
            }
            if existing.is_some() && invitation.1.as_deref() != Some(&email) {
                return Err("已有内测账号需要绑定邮箱的专属邀请".into());
            }
            if let Some((id, _)) = &existing {
                let disabled = tx
                    .query_row(
                        "SELECT disabled FROM account_access WHERE user_id=?1",
                        [id],
                        |r| r.get::<_, bool>(0),
                    )
                    .optional()
                    .map_err(|e| e.to_string())?
                    .unwrap_or(false);
                if disabled {
                    return Err("账号已停用，请联系管理员".into());
                }
            }
            let id = existing
                .map(|v| v.0)
                .unwrap_or_else(|| Uuid::new_v4().to_string());
            tx.execute(
                "INSERT OR IGNORE INTO users VALUES(?1,?2,?3)",
                params![id, email, now()],
            )
            .map_err(|e| e.to_string())?;
            tx.execute("INSERT INTO account_access(user_id,password_hash,admin,token_limit,media_limit) VALUES(?1,?2,?3,?4,?5) ON CONFLICT(user_id) DO UPDATE SET password_hash=excluded.password_hash,admin=excluded.admin,token_limit=account_access.used_tokens+excluded.token_limit,media_limit=account_access.used_media+excluded.media_limit",params![id,hash,invitation.4,invitation.2,invitation.3]).map_err(|e|e.to_string())?;
            tx.execute("DELETE FROM sessions WHERE user_id=?1", [&id])
                .map_err(|e| e.to_string())?;
            tx.execute(
                "UPDATE invites SET uses=uses+1 WHERE id=?1",
                [&invitation.0],
            )
            .map_err(|e| e.to_string())?;
            tx.execute(
                "INSERT INTO invite_redemptions VALUES(?1,?2,?3)",
                params![invitation.0, id, now()],
            )
            .map_err(|e| e.to_string())?;
            tx.commit().map_err(|e| e.to_string())?;
        } else {
            let saved=self.0.lock().map_err(|e|e.to_string())?.query_row("SELECT a.password_hash FROM users u JOIN account_access a ON a.user_id=u.id WHERE u.email=?1 AND a.disabled=0",[&email],|r|r.get::<_,Option<String>>(0)).optional().map_err(|e|e.to_string())?.flatten();
            // Missing accounts perform the same expensive verification as existing ones.
            let dummy = password_hash("unavailable-account-password")?;
            let parsed = PasswordHash::new(saved.as_deref().unwrap_or(&dummy))
                .map_err(|_| "邮箱或密码不正确")?;
            if Argon2::default()
                .verify_password(password.as_bytes(), &parsed)
                .is_err()
                || saved.is_none()
            {
                return Err("邮箱或密码不正确".into());
            }
        }
        let db = self.0.lock().map_err(|e| e.to_string())?;
        let user=db.query_row("SELECT u.id,a.admin FROM users u JOIN account_access a ON a.user_id=u.id WHERE u.email=?1 AND a.disabled=0",[&email],|r|Ok(User{id:r.get(0)?,email:email.clone(),is_admin:r.get::<_,bool>(1)? || self.1.contains(&email)})).map_err(|_|"账号不可用，请联系管理员")?;
        let token = secret();
        db.execute(
            "INSERT INTO sessions VALUES(?1,?2,?3)",
            params![digest(&token), user.id, now() + 30 * 86400],
        )
        .map_err(|e| e.to_string())?;
        db.execute("DELETE FROM auth_attempts WHERE key=?1", [digest(&email)])
            .map_err(|e| e.to_string())?;
        db.execute("INSERT INTO user_profiles(user_id,last_login) VALUES(?1,?2) ON CONFLICT(user_id) DO UPDATE SET last_login=excluded.last_login",params![user.id,now()]).map_err(|e|e.to_string())?;
        Ok((user, token))
    }

    fn auth_attempt(&self, email: &str) -> Result<(), String> {
        let db = self.0.lock().map_err(|e| e.to_string())?;
        db.execute("DELETE FROM auth_attempts WHERE window<?1", [now() - 900])
            .map_err(|e| e.to_string())?;
        db.execute("INSERT INTO auth_attempts VALUES(?1,1,?2) ON CONFLICT(key) DO UPDATE SET attempts=attempts+1",params![digest(email),now()]).map_err(|e|e.to_string())?;
        let attempts: i64 = db
            .query_row(
                "SELECT attempts FROM auth_attempts WHERE key=?1",
                [digest(email)],
                |r| r.get(0),
            )
            .map_err(|e| e.to_string())?;
        if attempts > 10 {
            return Err("尝试次数过多，请 15 分钟后重试".into());
        }
        Ok(())
    }

    pub fn quota(&self, user: &str) -> Result<Quota, String> {
        let db = self.0.lock().map_err(|e| e.to_string())?;
        quota(&db, user)
    }
    pub fn check_quota(&self, user: &str) -> Result<(), String> {
        let q = self.quota(user)?;
        if q.disabled {
            return Err("账号已停用，请联系管理员".into());
        }
        if q.remaining_tokens <= 0 {
            return Err("Token 额度已用完或正在使用，请联系管理员或稍后重试".into());
        }
        Ok(())
    }
    pub fn consume_media(&self, user: &str) -> Result<(), String> {
        let db = self.0.lock().map_err(|e| e.to_string())?;
        let changed=db.execute("UPDATE account_access SET used_media=used_media+1 WHERE user_id=?1 AND disabled=0 AND used_media+COALESCE((SELECT SUM(media) FROM model_charges WHERE user_id=?1 AND status='running'),0)<media_limit",[user]).map_err(|e|e.to_string())?;
        if changed == 0 {
            return Err("素材生成额度已用完或账号已停用，请联系管理员".into());
        }
        Ok(())
    }
    pub fn reserve_model(&self, user: &str) -> Result<ModelCharge, String> {
        let mut db = self.0.lock().map_err(|e| e.to_string())?;
        let tx = db.transaction().map_err(|e| e.to_string())?;
        let q = quota(&tx, user)?;
        if q.disabled || q.remaining_tokens <= 0 {
            return Err("Token 额度已用完或正在使用，请联系管理员或稍后重试".into());
        }
        let id = Uuid::new_v4().to_string();
        tx.execute("INSERT INTO model_charges(id,user_id,reserved,status,created_at) VALUES(?1,?2,?3,'running',?4)",params![id,user,q.remaining_tokens.min(32768),now()]).map_err(|e|e.to_string())?;
        tx.commit().map_err(|e| e.to_string())?;
        Ok(ModelCharge {
            accounts: self.clone(),
            usage: None,
            id,
            settled: false,
            sent: false,
        })
    }
    pub fn list_invites(&self) -> Result<Value, String> {
        let db = self.0.lock().map_err(|e| e.to_string())?;
        let mut stmt=db.prepare("SELECT id,email,expires_at,max_uses,uses,token_limit,media_limit,revoked FROM invites ORDER BY created_at DESC,id").map_err(|e|e.to_string())?;
        let rows=stmt.query_map([],|r|Ok(json!({"id":r.get::<_,String>(0)?,"email":r.get::<_,Option<String>>(1)?,"expiresAt":r.get::<_,i64>(2)?,"maxUses":r.get::<_,i64>(3)?,"uses":r.get::<_,i64>(4)?,"tokenLimit":r.get::<_,i64>(5)?,"mediaLimit":r.get::<_,i64>(6)?,"revoked":r.get::<_,bool>(7)?}))).map_err(|e|e.to_string())?.collect::<Result<Vec<_>,_>>().map_err(|e|e.to_string())?;
        Ok(json!({"invites":rows}))
    }
    pub fn revoke_invite(&self, id: &str) -> Result<(), String> {
        let mut db = self.0.lock().map_err(|e| e.to_string())?;
        let tx = db.transaction().map_err(|e| e.to_string())?;
        if tx
            .execute("UPDATE invites SET revoked=1 WHERE id=?1", [id])
            .map_err(|e| e.to_string())?
            != 1
        {
            return Err("邀请不存在".into());
        }
        super::management::bump_revision(&tx, "invite", id)?;
        tx.commit().map_err(|e| e.to_string())
    }
    pub fn update_account(
        &self,
        actor: &str,
        user: &str,
        tokens: i64,
        media: i64,
        disabled: Option<bool>,
        request_id: &str,
    ) -> Result<(), String> {
        if !(0..=1_000_000_000_000).contains(&tokens)
            || !(0..=1_000_000).contains(&media)
            || Uuid::parse_str(request_id).is_err()
        {
            return Err("追加额度或请求编号无效".into());
        }
        if actor == user && disabled == Some(true) {
            return Err("不能停用当前管理员账号".into());
        }
        let mut db = self.0.lock().map_err(|e| e.to_string())?;
        let tx = db.transaction().map_err(|e| e.to_string())?;
        if tx
            .query_row(
                "SELECT 1 FROM account_changes WHERE id=?1",
                [request_id],
                |r| r.get::<_, i64>(0),
            )
            .optional()
            .map_err(|e| e.to_string())?
            .is_some()
        {
            return Ok(());
        }
        let changed=tx.execute("UPDATE account_access SET token_limit=token_limit+?2,media_limit=media_limit+?3,disabled=COALESCE(?4,disabled) WHERE user_id=?1",params![user,tokens,media,disabled]).map_err(|e|e.to_string())?;
        if changed == 0 {
            return Err("账号不存在".into());
        }
        if disabled == Some(true) {
            tx.execute("DELETE FROM sessions WHERE user_id=?1", [user])
                .map_err(|e| e.to_string())?;
        }
        tx.execute(
            "INSERT INTO account_changes VALUES(?1,?2,?3,?4,?5,?6)",
            params![request_id, user, actor, tokens, media, now()],
        )
        .map_err(|e| e.to_string())?;
        super::management::bump_revision(&tx, "user", user)?;
        if disabled == Some(false) {
            tx.execute(
                "UPDATE user_profiles SET archived=0 WHERE user_id=?1",
                [user],
            )
            .map_err(|e| e.to_string())?;
        }
        super::management::audit(
            &tx,
            actor,
            "追加用户额度",
            user,
            json!({"tokens":tokens,"media":media,"disabled":disabled}),
        )?;
        tx.commit().map_err(|e| e.to_string())
    }
}

pub(super) fn quota(db: &Connection, user: &str) -> Result<Quota, String> {
    db.query_row("SELECT token_limit,used_tokens,media_limit,used_media,disabled,
      COALESCE((SELECT SUM(reserved) FROM model_charges WHERE user_id=?1 AND status='running'),0),
      (SELECT COUNT(*) FROM model_charges WHERE user_id=?1 AND status='unknown'),
      COALESCE((SELECT SUM(media) FROM model_charges WHERE user_id=?1 AND status='running'),0) FROM account_access WHERE user_id=?1",[user],|r| {
        let token_limit:i64=r.get(0)?;let used_tokens:i64=r.get(1)?;let media_limit:i64=r.get(2)?;let used_media:i64=r.get(3)?;let reserved_tokens:i64=r.get(5)?;
        let reserved_media:i64=r.get(7)?;
        Ok(Quota{token_limit,used_tokens,reserved_tokens,remaining_tokens:(token_limit-used_tokens-reserved_tokens).max(0),media_limit,used_media,reserved_media,remaining_media:(media_limit-used_media-reserved_media).max(0),disabled:r.get(4)?,unknown_calls:r.get(6)?})
    }).map_err(|_|"账号额度不可用".into())
}

pub struct ModelCharge {
    accounts: Accounts,
    id: String,
    settled: bool,
    sent: bool,
    usage: Option<super::TokenUsage>,
}
impl ModelCharge {
    pub fn set_billing_model(&self, model: &str) -> Result<(), String> {
        let db = self.accounts.0.lock().map_err(|e| e.to_string())?;
        super::billing::begin(&db, &self.id, model)
    }
    pub fn record_usage(&mut self, usage: Option<super::TokenUsage>) {
        self.usage = usage;
    }
    pub fn mark_sent(&mut self) {
        self.sent = true;
    }
    pub fn reserve_image(&self) -> Result<bool, String> {
        let db = self.accounts.0.lock().map_err(|e| e.to_string())?;
        db.execute("UPDATE model_charges SET media=1 WHERE id=?1 AND status='running' AND EXISTS(SELECT 1 FROM account_access a WHERE a.user_id=model_charges.user_id AND a.disabled=0 AND a.used_media+COALESCE((SELECT SUM(c.media) FROM model_charges c WHERE c.user_id=a.user_id AND c.status='running'),0)<a.media_limit)",[&self.id]).map(|n|n==1).map_err(|e|e.to_string())
    }
    pub fn settle(&mut self, tokens: Option<i64>, media: i64) -> Result<(), String> {
        let mut db = self.accounts.0.lock().map_err(|e| e.to_string())?;
        let tx = db.transaction().map_err(|e| e.to_string())?;
        let row = tx
            .query_row(
                "SELECT user_id,reserved,media FROM model_charges WHERE id=?1 AND status='running'",
                [&self.id],
                |r| {
                    Ok((
                        r.get::<_, String>(0)?,
                        r.get::<_, i64>(1)?,
                        r.get::<_, i64>(2)?,
                    ))
                },
            )
            .optional()
            .map_err(|e| e.to_string())?;
        if let Some((user, reserved, reserved_media)) = row {
            super::billing::settle(&tx, &self.id, self.usage.as_ref(), tokens)?;
            let media = if tokens.is_none() {
                media.max(reserved_media)
            } else {
                media
            };
            let charged = tokens.unwrap_or(reserved).max(0);
            tx.execute("UPDATE account_access SET used_tokens=used_tokens+?2,used_media=used_media+?3 WHERE user_id=?1",params![user,charged,media.max(0)]).map_err(|e|e.to_string())?;
            tx.execute(
                "UPDATE model_charges SET tokens=?2,media=?3,status=?4 WHERE id=?1",
                params![
                    self.id,
                    charged,
                    media.max(0),
                    if tokens.is_some() {
                        "settled"
                    } else {
                        "unknown"
                    }
                ],
            )
            .map_err(|e| e.to_string())?;
        }
        tx.commit().map_err(|e| e.to_string())?;
        self.settled = true;
        Ok(())
    }
}
impl Drop for ModelCharge {
    fn drop(&mut self) {
        if !self.settled
            && let Err(error) = self.settle(if self.sent { None } else { Some(0) }, 0)
        {
            tracing::error!(%error,"failed to settle model reservation");
        }
    }
}
