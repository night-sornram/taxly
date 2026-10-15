# Rust Workspace Structure

- `crates/taxly-core`: Money, domain model, versioned rules และ pure calculation
- `apps/desktop/src-tauri`: commands, services, storage, catalog, backup และ SQLx migrations
- `apps/desktop/src`: React screens, components, exact money formatting และ IPC adapter
- `rules/2025`, `rules/2026`: payloads พร้อม source metadata
- `rules/manifest.json`: SHA-256 ของ payload ที่แอปยอมรับ
- `apps/desktop/e2e`: browser IPC adapter และ contract fixture ที่ได้จาก Rust

ใช้ Cargo workspace สองสมาชิก, Rust 1.95.0, edition 2024 และ npm มี lockfiles ทั้งสองฝั่ง

Core ไม่ขึ้นกับ Tauri และสามารถนำไปใช้ใน mobile application ต่อได้ Native dialogs/opener แยกอยู่ใน commands ไม่สร้าง platform abstraction ที่ยังไม่ได้ใช้

Generated permissions และ build artifacts ไม่ต้อง commit สามารถสร้างใหม่จาก build.rs ได้
