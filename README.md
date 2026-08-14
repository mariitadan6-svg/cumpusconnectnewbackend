# CampusConnect Backend

## Deploy to Render.com
1. Push this `backend/` folder to a GitHub repo
2. On Render → New → Web Service → connect the repo
3. **Root Directory:** `backend` (if the repo has both folders)
4. **Environment:** Node
5. **Build Command:** `npm install`
6. **Start Command:** `npm start`
7. Add env var `JWT_SECRET` = any long random string
8. Deploy

### Why this backend won't fail on Render
- Zero native modules (no `better-sqlite3`, no `gyp`, no `make`/`g++`)
- No `apt-get` in build (Render's build image is read-only for apt)
- Uses Node 18+ (declared in `engines`)
- All dependencies pin to versions that actually exist on npm (no `ETARGET` errors)
- All required files exist — no `Cannot find module` at start

## Local
```
npm install
npm start
```
Runs on http://localhost:5000
