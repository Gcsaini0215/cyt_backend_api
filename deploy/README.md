# Backend auto-deploy (pull-based)

GitHub Actions can't deploy this repo (its VPS secrets are wrong and only the repo owner can fix
them), so the server pulls instead: every 2 minutes `cyt-backend-autodeploy.sh` checks GitHub and
deploys new commits on `main` — only the changed files, syntax-checked, backed up, with an
automatic rollback if the API doesn't answer after the restart.

## Install (once, in the Hostinger browser terminal as root)

```bash
git clone -q https://github.com/Gcsaini0215/cyt_backend_api.git /root/cyt_backend_src
mkdir -p /root/bin && cp /root/cyt_backend_src/deploy/cyt-backend-autodeploy.sh /root/bin/ && chmod +x /root/bin/cyt-backend-autodeploy.sh
cd /root/cyt_backend_src && git rev-parse origin/main > /root/.cyt_backend_deployed_sha   # what's live right now
(crontab -l 2>/dev/null; echo "*/2 * * * * /root/bin/cyt-backend-autodeploy.sh") | crontab -
```

## Use

- Push to `main` → live in about 2–4 minutes.
- Log: `tail -20 /var/log/cyt-backend-deploy.log`
- A commit that fails the syntax check or the health check is skipped (and rolled back); push a
  fix and it deploys the fix.
- Undo an install: `crontab -e` and delete the line.
- Never copied: `.env`, `uploads/`, `node_modules/`, `*.log`, `.github/`, `deploy/`.
- Files deleted in git are left on the server (logged), to be safe.
