use crate::db::ConnectionProfile;

#[allow(dead_code)]
pub(crate) async fn connect_extension(profile: &ConnectionProfile) -> Result<(), String> {
    Err(format!(
        "connector extension dispatch is not wired yet for {:?}",
        profile.engine
    ))
}
