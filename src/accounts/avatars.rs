use super::*;
use image::{DynamicImage, ImageDecoder, ImageFormat, ImageReader, Limits, imageops::FilterType};
use std::io::Cursor;

pub(super) fn migrate(db: &Connection) -> Result<(), String> {
    db.execute_batch("CREATE TABLE IF NOT EXISTS account_avatars(
        user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        preset TEXT CHECK(preset IN ('cat','bunny','fox','panda')),
        image BLOB, revision TEXT NOT NULL,
        CHECK((preset IS NOT NULL AND image IS NULL) OR (preset IS NULL AND image IS NOT NULL)));
      INSERT OR IGNORE INTO account_avatars(user_id,preset,revision)
        SELECT id, CASE abs(random()%4) WHEN 0 THEN 'cat' WHEN 1 THEN 'bunny' WHEN 2 THEN 'fox' ELSE 'panda' END, 'initial' FROM users;
      CREATE TRIGGER IF NOT EXISTS assign_account_avatar AFTER INSERT ON users BEGIN
        INSERT INTO account_avatars(user_id,preset,revision) VALUES(NEW.id,
          CASE abs(random()%4) WHEN 0 THEN 'cat' WHEN 1 THEN 'bunny' WHEN 2 THEN 'fox' ELSE 'panda' END, 'initial');
      END;")
      .map_err(|e| e.to_string())
}

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Avatar {
    pub preset_id: Option<String>,
    pub url: String,
}

impl Accounts {
    pub fn avatar(&self, user: &str) -> Result<Avatar, String> {
        self.0
            .lock()
            .unwrap()
            .query_row(
                "SELECT preset,revision FROM account_avatars WHERE user_id=?1",
                [user],
                |row| {
                    let preset: Option<String> = row.get(0)?;
                    let revision: String = row.get(1)?;
                    let url = match &preset {
                        Some(id) => format!("/avatars/{id}-v1.webp"),
                        None => format!("/api/auth/avatar/image?v={revision}"),
                    };
                    Ok(Avatar {
                        preset_id: preset,
                        url,
                    })
                },
            )
            .map_err(|_| "无法读取头像，请重试".into())
    }

    pub fn set_avatar_preset(&self, user: &str, preset: &str) -> Result<Avatar, String> {
        if !["cat", "bunny", "fox", "panda"].contains(&preset) {
            return Err("请选择提供的头像".into());
        }
        self.0
            .lock()
            .unwrap()
            .execute(
                "UPDATE account_avatars SET preset=?2,image=NULL,revision=?2 WHERE user_id=?1",
                params![user, preset],
            )
            .map_err(|e| e.to_string())?;
        self.avatar(user)
    }

    pub fn set_avatar_image(&self, user: &str, image: &[u8]) -> Result<Avatar, String> {
        let revision = format!("{:x}", Sha256::digest(image));
        self.0
            .lock()
            .unwrap()
            .execute(
                "UPDATE account_avatars SET preset=NULL,image=?2,revision=?3 WHERE user_id=?1",
                params![user, image, revision],
            )
            .map_err(|e| e.to_string())?;
        self.avatar(user)
    }

    pub fn avatar_image(&self, user: &str) -> Result<Vec<u8>, String> {
        self.0
            .lock()
            .unwrap()
            .query_row(
                "SELECT image FROM account_avatars WHERE user_id=?1 AND image IS NOT NULL",
                [user],
                |r| r.get(0),
            )
            .map_err(|_| "尚未上传头像".into())
    }
}

/// Decode untrusted uploads with strict allocation bounds, then discard metadata
/// and any appended payload by encoding a small, static PNG.
pub fn normalize_avatar(bytes: &[u8]) -> Result<Vec<u8>, String> {
    if bytes.len() > 5 * 1024 * 1024 {
        return Err("头像图片不能超过 5 MB".into());
    }
    let mut reader = ImageReader::new(Cursor::new(bytes))
        .with_guessed_format()
        .map_err(|_| "图片无法读取".to_string())?;
    if !matches!(
        reader.format(),
        Some(ImageFormat::Png | ImageFormat::Jpeg | ImageFormat::WebP)
    ) {
        return Err("请选择 PNG、JPEG 或 WebP 图片".into());
    }
    let mut limits = Limits::default();
    limits.max_image_width = Some(4096);
    limits.max_image_height = Some(4096);
    limits.max_alloc = Some(64 * 1024 * 1024);
    reader.limits(limits);
    let invalid = || "图片损坏或尺寸过大，请选择不超过 4096×4096 的图片".to_string();
    let mut decoder = reader.into_decoder().map_err(|_| invalid())?;
    if decoder.total_bytes() > 64 * 1024 * 1024 {
        return Err(invalid());
    }
    let orientation = decoder.orientation().map_err(|_| invalid())?;
    let mut image = DynamicImage::from_decoder(decoder).map_err(|_| invalid())?;
    image.apply_orientation(orientation);
    let mut output = Cursor::new(Vec::new());
    image
        .resize_to_fill(256, 256, FilterType::Lanczos3)
        .write_to(&mut output, ImageFormat::Png)
        .map_err(|_| "头像处理失败，请换一张图片".to_string())?;
    Ok(output.into_inner())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn assignment_is_persistent_and_changes_are_isolated() {
        let db = Accounts::open(Path::new(":memory:"), vec![]).unwrap();
        let (a, _) = db.login("a@example.com").unwrap();
        let (b, _) = db.login("b@example.com").unwrap();
        let initial = db.avatar(&a.id).unwrap();
        assert!(["cat", "bunny", "fox", "panda"].contains(&initial.preset_id.as_deref().unwrap()));
        migrate(&db.0.lock().unwrap()).unwrap();
        assert_eq!(db.avatar(&a.id).unwrap(), initial);
        let other = db.avatar(&b.id).unwrap();
        db.set_avatar_preset(&a.id, "fox").unwrap();
        assert_eq!(db.avatar(&b.id).unwrap(), other);
        assert!(db.set_avatar_preset(&a.id, "../../secret").is_err());
        assert_eq!(db.avatar(&a.id).unwrap().preset_id.as_deref(), Some("fox"));
    }

    #[test]
    fn upload_is_decoded_resized_and_replaces_only_the_owners_avatar() {
        let db = Accounts::open(Path::new(":memory:"), vec![]).unwrap();
        let (a, _) = db.login("a@example.com").unwrap();
        let (b, _) = db.login("b@example.com").unwrap();
        let mut original = Cursor::new(Vec::new());
        image::DynamicImage::new_rgb8(80, 40)
            .write_to(&mut original, ImageFormat::Png)
            .unwrap();
        let normalized = normalize_avatar(&original.into_inner()).unwrap();
        let decoded = image::load_from_memory(&normalized).unwrap();
        assert_eq!((decoded.width(), decoded.height()), (256, 256));
        let saved = db.set_avatar_image(&a.id, &normalized).unwrap();
        assert_eq!(saved.preset_id, None);
        assert!(saved.url.starts_with("/api/auth/avatar/image?v="));
        assert!(db.avatar_image(&b.id).is_err());
        assert_eq!(db.avatar_image(&a.id).unwrap(), normalized);
        db.set_avatar_preset(&a.id, "bunny").unwrap();
        assert!(db.avatar_image(&a.id).is_err());
    }

    #[test]
    fn phone_photo_orientation_is_applied_before_cropping() {
        use image::{ImageEncoder, codecs::jpeg::JpegEncoder};
        let photo = image::RgbImage::from_fn(32, 32, |x, _| {
            if x < 16 {
                image::Rgb([255, 0, 0])
            } else {
                image::Rgb([0, 0, 255])
            }
        });
        let mut jpeg = Vec::new();
        let mut encoder = JpegEncoder::new_with_quality(&mut jpeg, 95);
        // Little-endian TIFF, orientation 6: rotate 90 degrees clockwise.
        encoder
            .set_exif_metadata(vec![
                73, 73, 42, 0, 8, 0, 0, 0, 1, 0, 18, 1, 3, 0, 1, 0, 0, 0, 6, 0, 0, 0, 0, 0, 0, 0,
            ])
            .unwrap();
        encoder.encode_image(&photo).unwrap();
        let normalized = normalize_avatar(&jpeg).unwrap();
        let decoded = image::load_from_memory(&normalized).unwrap().to_rgb8();
        assert!(decoded.get_pixel(128, 32)[0] > 240);
        assert!(decoded.get_pixel(128, 224)[2] > 240);
    }

    #[test]
    fn invalid_images_and_oversized_uploads_are_rejected() {
        assert!(normalize_avatar(b"<svg onload='alert(1)'/>").is_err());
        assert!(normalize_avatar(b"\x89PNG\r\n\x1a\nnot an image").is_err());
        assert!(normalize_avatar(&vec![0; 5 * 1024 * 1024 + 1]).is_err());
    }
}
