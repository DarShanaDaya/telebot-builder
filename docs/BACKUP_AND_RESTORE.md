# Backup and Restore

## Flow backup (available in the Builder)

Use **Export** in the Builder to download a portable flow backup. Export is available only after the current draft is saved, so the archive exactly matches the saved draft.

The archive is versioned and contains the flow graph, node configuration, and non-secret credential requirements. It deliberately does **not** contain:

- BotFather tokens
- Credential secrets or internal credential IDs
- Webhook secrets
- Sessions, messages, logs, or user data

Use **Import** to restore an archive as a draft. Import never changes the published flow. The app validates the archive and requires matching credentials by name and type before it saves the draft. Review the draft, validate it, then publish explicitly.

## Secure workspace backup

A full workspace backup—including bot tokens or credential secrets—is **not implemented yet**. Do not treat a flow export as a disaster-recovery backup for secrets. Until encrypted workspace archives are delivered, retain BotFather tokens and credential source material in your approved secret manager and recreate credentials after restoring a flow.

## Operational database backup

Operational backups are distinct from user flow exports and must be performed by the deployment operator.

### SQLite

- Use SQLite's online backup facility or a consistent `VACUUM INTO` job; never copy a live database file directly.
- Back up `.data/secrets.json` only through an encrypted, access-controlled secret backup. Without the platform encryption key, stored bot tokens and credentials cannot be decrypted.
- Store encrypted backups off-host and regularly restore one into an isolated environment.

### Supabase/Postgres

- Enable provider point-in-time recovery and scheduled backups.
- Keep backup access separate from routine application credentials.
- Perform restore drills that include database schema, application encryption keys, and a stopped-bot verification.

## Restore safety checklist

1. Restore into an isolated/staging environment first.
2. Verify the encryption-key material is available before declaring success.
3. Keep restored bots **stopped** until their flow, credentials, and webhook URLs are reviewed.
4. Register webhooks or start polling only through an explicit deploy action.
5. Record restore date, operator, source backup, result, and follow-up actions.
