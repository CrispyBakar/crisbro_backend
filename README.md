# Crisbro Backend

Backend API untuk aplikasi loyalty Crisbar/Crisbro. Menangani autentikasi
customer & staff, data customer dan poin, referral, katalog produk loyalty,
lokasi outlet, promo, serta sinkronisasi data dari Runchise (POS).

## Tech Stack

- Node.js 22+ (CommonJS) + Express 5
- PostgreSQL (Supabase) + Prisma ORM 6
- Redis + BullMQ untuk background worker
- Zod untuk validasi request
- JWT (cookie httpOnly atau Bearer token)
- Integrasi: Runchise (POS), Fazpass (OTP), Qontak (WhatsApp), SMTP (email)
- Deploy ke Vercel

## Quick Start

```bash
npm install          # otomatis menjalankan `prisma generate`
# buat file .env — lihat bagian Environment Variables
npm run db:migrate   # terapkan migration ke database development
npm run dev          # API di http://localhost:5002
```

Worker sinkronisasi berjalan sebagai proses terpisah (butuh Redis):

```bash
npm run worker:customer-sync
```

Cek server hidup: `GET /` → `{ "message": "API Running" }`.

## Environment Variables

Buat file `.env` di root folder backend. Jangan commit file ini.

### Wajib

| Variabel | Keterangan |
| --- | --- |
| `DATABASE_URL` | Koneksi Postgres untuk aplikasi (Supabase transaction pooler, port 6543) |
| `DIRECT_URL` | Koneksi Postgres session-mode (port 5432). Dipakai untuk migration dan advisory lock — tanpa ini lock fail-closed |
| `JWT_SECRET` | Secret penandatanganan JWT. Gunakan nilai acak yang panjang |
| `RUNCHISE_API_KEY` | API key Runchise |
| `FRONTEND_URL` | Origin frontend; otomatis masuk allowlist CORS |

### Integrasi

| Variabel | Keterangan |
| --- | --- |
| `FAZPASS_BASE_URL`, `FAZPASS_MERCHANT_KEY`, `FAZPASS_GATEWEY_KEY` | OTP via Fazpass (perhatikan ejaan `GATEWEY`) |
| `QONTAK_BASE_URL`, `QONTAK_CLIENT_ID`, `QONTAK_CLIENT_SECRET` | WhatsApp via Qontak |
| `QONTAK_DEV_CLIENT_ID`, `QONTAK_DEV_CLIENT_SECRET` | Kredensial Qontak environment dev |
| `QONTAK_TEMPLATE_ID`, `QONTAK_CHANNEL_ID` | Template pesan & channel WhatsApp |
| `MAIL_FROM`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_SECURE` | Pengiriman email |
| `REFERRAL_VALIDATION_URL` | URL yang dicantumkan pada alur validasi referral |

### Redis (khusus worker)

| Variabel | Default | Keterangan |
| --- | --- | --- |
| `REDIS_URL` | – | Jika diisi, menggantikan variabel di bawah. Pakai `rediss://` untuk TLS; URL-encode karakter khusus |
| `REDIS_HOST` | `127.0.0.1` | |
| `REDIS_PORT` | `6379` | |
| `REDIS_USERNAME` | – | Untuk Redis ACL |
| `REDIS_PASSWORD` | – | Kosongkan bila Redis tanpa autentikasi |

### Opsional

| Variabel | Default | Keterangan |
| --- | --- | --- |
| `PORT` | `5002` | Port HTTP |
| `NODE_ENV` | – | `production` mengaktifkan CORS ketat, cookie `Secure`, dan menutup Swagger |
| `CORS_ORIGINS` | – | Origin tambahan, dipisah koma |
| `SESSION_COOKIE_NAME` | `crisbar_session` | |
| `SESSION_COOKIE_SAME_SITE` | `none` (prod) / `strict` (dev) | |
| `JWT_EXPIRES_IN` | `7d` | Batas absolut sesi customer |
| `CUSTOMER_SESSION_IDLE_DAYS` | `7` | |
| `ADMIN_SESSION_IDLE_MINUTES` | `480` | Idle timeout staff (admin/marketing) |
| `ADMIN_SESSION_ABSOLUTE_HOURS` | `24` | Batas absolut sesi staff |
| `SESSION_RENEW_INTERVAL_MINUTES` | `5` | |
| `API_DOCS_ENABLED` | `false` | Buka Swagger di production (wajib dengan `API_DOCS_USER` + `API_DOCS_PASSWORD`) |

## NPM Scripts

| Script | Fungsi |
| --- | --- |
| `npm run dev` | Jalankan API dengan nodemon |
| `npm run worker:customer-sync` | Jalankan worker BullMQ (proses terpisah) |
| `npm run lint` | ESLint |
| `npm run db:migrate` | `prisma migrate dev` lewat `DIRECT_URL` (argumen tambahan diteruskan, mis. `-- --name add_x`) |
| `npm run db:unlock` | Tampilkan pemegang advisory lock Postgres; tambah `-- --kill` untuk menghentikannya |

## Database

Skema ada di [prisma/schema.prisma](prisma/schema.prisma), diagram ERD di
[prisma/crisbro_erd.svg](prisma/crisbro_erd.svg).

- **Selalu migrasi lewat `npm run db:migrate`**, bukan `npx prisma migrate dev`
  langsung. Migration lewat transaction pooler (`DATABASE_URL`) meninggalkan
  advisory lock menggantung di Supabase dan menyebabkan error `P1002`.
- Jika tetap kena `P1002`: `npm run db:unlock` lalu `npm run db:unlock -- --kill`.
- Production: `npx prisma migrate deploy`.
- Seed data dasar (brand, penanda lokasi non-outlet): `node prisma/seed.js`.
- GUI database: `npx prisma studio`.

## Background Worker

`npm run worker:customer-sync` mendaftarkan dua job scheduler BullMQ. ID
scheduler tetap, jadi restart tidak membuat jadwal ganda. Keduanya memakai
concurrency 1.

| Queue | Jadwal | Isi pekerjaan |
| --- | --- | --- |
| `customer-sync` | tiap 5 menit | Tarik sale transaction baru dari Runchise per lokasi (mulai dari checkpoint di `SyncCheckpoints`), update data customer terkait, sinkronkan status promo & promo code, lalu simpan checkpoint baru |
| `customer-point-daily` | `0 1 * * *` (01:00) | Refresh data & poin seluruh customer aktif yang sudah terhubung ke Runchise, lalu update riwayat poin |

`npm run dev` hanya menjalankan API — worker harus dijalankan dan dijaga
hidup sendiri.

## Autentikasi & Keamanan Request

- **Token**: cookie httpOnly `crisbar_session` (diprioritaskan, untuk browser)
  atau header `Authorization: Bearer <token>` (untuk tooling API).
- **CSRF**: request non-GET yang membawa cookie sesi wajib mengirim header
  `x-csrf-protection: 1`, jika tidak akan ditolak `403`.
- **Role**: `admin`, `marketing` (disebut *staff*), dan `customer`.
- **Rate limit**: global 300 request / 5 menit, plus limiter lebih ketat
  untuk login, OTP, dan endpoint sinkronisasi berat
  (lihat [src/lib/rateLimit.js](src/lib/rateLimit.js)).
- Body JSON dibatasi 100 KB; Helmet memasang CSP ketat secara global.

## Endpoint

Semua endpoint berada di bawah prefix `/api`. Dokumentasi lengkap (Swagger UI)
tersedia di `GET /api/docs` dan spec di `GET /api/docs/openapi.json` — terbuka
di development, tertutup (404) di production kecuali `API_DOCS_ENABLED=true`.

| Grup | Path | Akses |
| --- | --- | --- |
| Auth | `POST /register`, `POST /login`, `POST /send-otp`, `POST /verify-otp`, `POST /logout`, `POST /logout-all`, `POST /change-password` | Publik / login |
| Profil | `GET /profile` (customer), `GET /me` (staff) | Login |
| Customer (self) | `GET/PATCH /customers/me`, `GET /customers/me/point-history` | customer |
| Customer (kelola) | `GET /customers`, `GET/PATCH /customers/:customer_id`, `PATCH /customers/:customer_id/status`, `GET /customers/:customer_id/point-history`, `GET /customers/user/:user_id` | admin, marketing |
| Customer sync | `POST /customers/generate` | admin |
| Staff user | `POST /users`, `PATCH /users/:user_id` | admin |
| Referral | `POST /referral/generate`, `PATCH /referral/renew` | customer |
| | `GET /referral/usages`, `PATCH /referral/validate/:user_id` | admin, marketing |
| Produk | `GET /products/loyalty` | Login |
| | `GET /products`, `POST /products/sync-products`, `POST /products/sync-loyalty-products`, `DELETE /products/:loyalty_product_id` | admin, marketing |
| Promo | `GET/POST /promos`, `GET/PATCH /promos/:promo_id`, `PATCH /promos/:promo_id/activate`, `PATCH /promos/:promo_id/deactivate`, `POST /promos/:promo_id/promo-codes/generate`, `POST /promos/sync/:runchise_id` | admin, marketing |
| Sale transaction | `GET /sale-transactions/customer/:customer_id` | admin, marketing |
| | `POST /sale-transactions/generate`, `POST /sale-transactions/generate-all` | admin |
| Lokasi | `GET /locations` | Login |
| | `DELETE /locations/:location_id` | admin, marketing |
| | `POST /locations/generate` | admin |
| Dashboard | `GET /dashboard/total-counts`, `GET /dashboard/customers-per-outlet`, `GET /dashboard/top-redeemed-products`, `GET /dashboard/recent-transactions` | admin, marketing |
| Sub brand | `GET /sub_brands` | Publik |
| | `POST /sub_brands/generate` | admin |
| Webhook | `POST /webhook-qontak/<token>` — menerima pesan WhatsApp untuk verifikasi nomor customer | Qontak |

Endpoint `.../generate` dan `.../sync-*` menarik data dari Runchise lalu
menyimpannya ke database lokal.

## Struktur Folder

```txt
backend/
├── prisma/
│   ├── schema.prisma         # skema database
│   ├── migrations/           # riwayat migration
│   └── seed.js
├── scripts/                  # db-migrate.sh, db-unlock.mjs
├── src/
│   ├── index.js              # entry point Express
│   ├── routes/               # definisi route (routes.js = router utama)
│   ├── controllers/          # handler HTTP
│   ├── services/             # logika bisnis & client API eksternal
│   ├── validation/           # skema Zod per domain
│   ├── middleware/           # auth, role, CSRF, akses docs
│   ├── lib/                  # prisma, redis, queue, sesi, rate limit, CORS, dll.
│   ├── integration/qontak/   # client WhatsApp Qontak
│   ├── jobs/customer-sync/   # worker & scheduler BullMQ
│   ├── constants/
│   ├── utils/
│   └── docs/                 # openapi.yaml, swagger
├── tests/
└── vercel.json
```

## Testing

Test memakai runner bawaan Node dengan mock Prisma, jadi tidak butuh database:

```bash
node --test tests/
```

Saat ini `tests/promo.test.cjs` membutuhkan fixture `sample_promo.json` di root
backend yang belum ada di repository, sehingga test gagal dengan `ENOENT`
sampai fixture tersebut ditambahkan.

Catatan: `@prisma/client` memuat `.env` saat di-import, sehingga test bisa
hijau di lokal tetapi merah di CI (yang tidak punya `.env`). Untuk
mereproduksi kondisi CI, pindahkan `.env` sementara ke luar folder.

## Deployment (Vercel)

[vercel.json](vercel.json) mengarahkan semua request ke `src/index.js`.
`prisma generate` berjalan otomatis lewat `postinstall`. Pastikan semua
variabel pada bagian **Wajib** dan **Integrasi** sudah diisi di dashboard
Vercel, serta `NODE_ENV=production`.

Worker BullMQ **tidak** berjalan di Vercel (serverless); jalankan di server
yang bisa menjaga proses tetap hidup dan punya akses ke Redis.

## Catatan Keamanan

- Jangan commit `.env`, token, password, atau API key.
- Gunakan `JWT_SECRET` yang kuat di production.
- Biarkan `API_DOCS_ENABLED` nonaktif di production kecuali benar-benar perlu.
- Jangan menambah `'unsafe-inline'` / `'unsafe-eval'` pada CSP global; buat
  kebijakan khusus per-route bila ada halaman HTML yang butuh pengecualian
  (contoh: [src/middleware/docsCsp.js](src/middleware/docsCsp.js)).
- Path webhook Qontak berfungsi sebagai secret — jangan dibagikan.
