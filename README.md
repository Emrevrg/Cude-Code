# Codiente CLI

Güçlü, çok sağlayıcılı AI destekli CLI aracı — kodlama, otomasyon ve üretkenlik için. 13 AI sağlayıcısı, otonom ajan modu, oturum yönetimi, bütçe takibi ve güzel bir masaüstü uygulaması ile gelir.

---

## Özellikler

- **13 AI Sağlayıcısı** — Anthropic, OpenAI, Gemini, Groq, Ollama, OpenRouter, NVIDIA, Mistral, Together AI, Perplexity, DeepSeek, xAI, Cohere
- **Ücretsiz mod** — `--free` bayrağıyla ücretsiz sağlayıcılar (Groq, Gemini Flash, OpenRouter free models)
- **Otonom ajan** — Dosya okuma/yazma, komut çalıştırma araçlarıyla görevleri kendi kendine tamamlar
- **Akıllı model seçici** — Görev türüne ve bütçeye göre en uygun modeli otomatik seçer
- **Bütçe yönetimi** — Harcama limiti, aylık sıfırlama, uyarı eşiği
- **Oturum yönetimi** — Adlandırılmış sohbet oturumları, geçmiş, Markdown dışa aktarma
- **Akış desteği** — Gerçek zamanlı token akışı tüm sağlayıcılarda
- **Masaüstü uygulaması** — Electron tabanlı, Windows/macOS/Linux destekli GUI

---

## Kurulum

### Gereksinimler

- Node.js 20 veya üzeri
- npm 10 veya üzeri

### Kaynak koddan kurulum

```bash
git clone https://github.com/Emrevrg/Codiente-CLI.git
cd Codiente-CLI
npm install
npm run build
npm link          # codiente komutunu global olarak kullanılabilir yapar
```

### İlk kurulum

```bash
codiente setup
```

Kurulum sihirbazı hangi sağlayıcıları kullanmak istediğinizi sorar ve API anahtarlarını güvenli şekilde saklar.

---

## Kullanım

### Sohbet

```bash
# Varsayılan sağlayıcıyla sohbet başlat
codiente chat

# Ücretsiz sağlayıcıyla sohbet (Groq / Gemini Flash / Ollama)
codiente chat --free

# Belirli sağlayıcı ve modelle
codiente chat --provider anthropic --model claude-opus-4-8

# İsimli oturum oluştur veya devam et
codiente chat --session myproject

# Görev türü belirt (akıllı model seçimi için)
codiente chat --task code
codiente chat --task research    # Perplexity tercih edilir (web erişimli)
codiente chat --task reasoning   # DeepSeek R1 / Claude Opus tercih edilir
```

**Sohbet içi komutlar:**

| Komut | Açıklama |
|-------|----------|
| `/exit` veya `/quit` | Sohbetten çık |
| `/new` | Yeni sohbet başlat |
| `/clear` | Ekranı temizle |
| `/model <model>` | Modeli değiştir |
| `/save <ad>` | Oturumu kaydet |
| `/sessions` | Oturum listesini göster |
| `/budget` | Bütçe durumunu göster |
| `/help` | Komut listesini göster |

### Otonom Ajan

```bash
# Görevi planlayıp yürüt
codiente run "src/app.py dosyasındaki hataları düzelt"

# Onay sormadan çalıştır
codiente run "README.md oluştur" --yes

# Belirli sağlayıcıyla
codiente run "React todo uygulaması yaz ./myapp klasörüne" --provider anthropic

# Ücretsiz modelle
codiente run "bu dosyayı analiz et" --free

# Ayrıntılı çıktıyla
codiente run "testleri çalıştır ve hataları düzelt" --verbose
```

Ajan kullanabileceği araçlar:

- `read_file` — Dosya içeriğini okur
- `write_file` — Dosya yazar veya oluşturur
- `run_command` — Kabuk komutu çalıştırır (yıkıcı komutlarda onay ister)
- `list_directory` — Klasör içeriğini listeler
- `create_directory` — Klasör oluşturur

### Sağlayıcılar

```bash
# Tüm sağlayıcıları durumlarıyla listele
codiente providers list

# Yapılandırılmış sağlayıcıları test et
codiente providers test

# Kullanılabilir modelleri listele
codiente providers models

# Belirli sağlayıcının modellerini listele
codiente providers models anthropic
codiente providers models openrouter
```

### Yapılandırma

```bash
# API anahtarı ekle
codiente config set-key anthropic sk-ant-...
codiente config set-key openai sk-...
codiente config set-key gemini AIza...
codiente config set-key groq gsk_...
codiente config set-key openrouter sk-or-...
codiente config set-key nvidia nvapi-...
codiente config set-key mistral ...
codiente config set-key together ...
codiente config set-key perplexity pplx-...
codiente config set-key deepseek sk-...
codiente config set-key xai xai-...
codiente config set-key cohere ...

# API anahtarlarını göster (maskeli)
codiente config list-keys

# API anahtarı kaldır
codiente config remove-key openai

# Varsayılan sağlayıcı/model ayarla
codiente config set default-provider anthropic
codiente config set default-model claude-sonnet-4-6
```

### Bütçe Yönetimi

```bash
# Toplam bütçe limiti belirle (USD)
codiente budget set 20

# Aylık limit belirle
codiente budget set 10 --monthly

# Bütçe durumunu göster
codiente budget status

# Uyarı eşiği belirle
codiente budget alert 15

# Harcama sayacını sıfırla
codiente budget reset
```

### Oturum Yönetimi

```bash
# Tüm oturumları listele
codiente sessions list

# Bir oturumu devam ettir
codiente sessions continue myproject

# Oturumu Markdown olarak dışa aktar
codiente sessions export myproject ./sohbet.md

# Oturumu sil
codiente sessions delete myproject
```

### Masaüstü Uygulaması

```bash
# Masaüstü uygulamasını başlat
codiente desktop
```

CLI ile aynı `~/.codiente/` yapılandırmasını kullanır. API anahtarı ayarladıysanız masaüstü uygulamasında da otomatik görünür.

---

## Desteklenen Sağlayıcılar

| Sağlayıcı | Ücretsiz | Öne Çıkan Modeller |
|-----------|----------|-------------------|
| **Anthropic** | Hayır | claude-opus-4-8, claude-sonnet-4-6, claude-haiku-4-5 |
| **OpenAI** | Hayır | gpt-4o, gpt-4o-mini |
| **Google Gemini** | Flash free tier | gemini-1.5-pro, gemini-1.5-flash |
| **Groq** | Evet | llama-3.3-70b-versatile, llama-3.1-8b-instant |
| **Ollama** | Evet (yerel) | llama3, mistral, codellama, phi3, vb. |
| **OpenRouter** | Bazı modeller | 200+ model, `:free` suffix modeller ücretsiz |
| **NVIDIA NIM** | Hayır | nvidia/llama-3.1-nemotron-70b-instruct |
| **Mistral AI** | Hayır | mistral-large-latest, codestral-latest |
| **Together AI** | Hayır | Llama-3-70b, Mixtral-8x22B, Qwen2.5-72B |
| **Perplexity** | Hayır | sonar-huge (internet erişimli) |
| **DeepSeek** | Çok ucuz | deepseek-chat ($0.14/MTok), deepseek-reasoner |
| **xAI** | Hayır | grok-2-1212, grok-beta |
| **Cohere** | Hayır | command-r-plus, command-r |

---

## Akıllı Model Seçici

`--task` bayrağı veya sağlayıcı yapılandırmasına göre en uygun model otomatik seçilir:

| Görev Türü | Tercih Edilen Sağlayıcı/Model |
|------------|-------------------------------|
| `code` | claude-sonnet-4-6, gpt-4o, codestral |
| `complex` | claude-opus-4-8, gpt-4o |
| `quick` | claude-haiku-4-5, gpt-4o-mini |
| `research` | Perplexity sonar (web erişimli) |
| `reasoning` | DeepSeek R1, claude-opus-4-8 |
| `cheap` | DeepSeek Chat ($0.14/MTok), Mistral Small |
| `--free` | Groq llama-3.3-70b, Gemini Flash, Ollama |

Bütçe dolmak üzereyse otomatik olarak daha ucuz modele geçer.

---

## Masaüstü Uygulaması — Build

### Geliştirme modu

```bash
npm run dev:desktop
```

### Production build

```bash
# Tüm bileşenleri derle (CLI + Electron + React)
npm run build:all

# Platform paketleri oluştur
npm run package:win     # Windows — NSIS yükleyici
npm run package:mac     # macOS — DMG
npm run package:linux   # Linux — AppImage
npm run package:all     # Üç platform birden
```

Paketler `dist-packages/` klasörüne çıkar.

---

## Yapılandırma Dosyaları

Tüm veriler `~/.codiente/` klasöründe saklanır:

```
~/.codiente/
  config.json          # API anahtarları ve tercihler
  budget.json          # Bütçe limitleri ve harcama geçmişi
  sessions/
    <uuid>.json        # Her oturum ayrı JSON dosyası
```

---

## Geliştirme

```bash
# TypeScript kaynak kodunu izleme modunda derle
npm run build -- --watch

# CLI'yi doğrudan TypeScript'ten çalıştır (tsx ile)
npm run dev -- chat

# Electron TypeScript derle
npm run build:electron

# React renderer derle
npm run build:renderer

# Tip kontrolü (derleme yapmadan)
npx tsc --noEmit
```

### Proje Yapısı

```
Codiente-CLI/
├── src/                      # CLI kaynak kodu (TypeScript ESM)
│   ├── index.ts              # Giriş noktası
│   ├── cli.ts                # Commander.js komut tanımları
│   ├── config/
│   │   ├── index.ts          # Yapılandırma yönetimi (Conf)
│   │   └── models.ts         # Model tanımları ve fiyatlandırma
│   ├── providers/            # AI sağlayıcı implementasyonları
│   │   ├── types.ts          # Provider arayüzleri
│   │   ├── anthropic.ts
│   │   ├── openai.ts
│   │   ├── gemini.ts
│   │   ├── groq.ts
│   │   ├── ollama.ts
│   │   ├── openrouter.ts
│   │   ├── nvidia.ts
│   │   ├── mistral.ts
│   │   ├── together.ts
│   │   ├── perplexity.ts
│   │   ├── deepseek.ts
│   │   ├── xai.ts
│   │   ├── cohere.ts
│   │   └── index.ts          # Sağlayıcı fabrikası
│   ├── storage/
│   │   ├── sessions.ts       # Oturum depolama
│   │   └── budget.ts         # Bütçe takibi
│   ├── commands/             # CLI komut implementasyonları
│   │   ├── chat.ts
│   │   ├── run.ts
│   │   ├── config.ts
│   │   ├── budget.ts
│   │   ├── sessions.ts
│   │   ├── providers.ts
│   │   └── desktop.ts
│   ├── core/
│   │   ├── agent.ts          # Otonom ajan döngüsü
│   │   ├── tools.ts          # Ajan araçları
│   │   └── selector.ts       # Akıllı model seçici
│   └── ui/
│       ├── display.ts        # Terminal UI yardımcıları
│       └── spinner.ts        # Ora sarmalayıcı
├── electron/                 # Electron ana süreç (CommonJS)
│   ├── main.ts
│   ├── preload.ts
│   └── ipc/
│       ├── chat.ts
│       ├── config.ts
│       ├── sessions.ts
│       ├── budget.ts
│       └── providers.ts
├── renderer/                 # React uygulaması (Vite + Tailwind)
│   ├── index.html
│   ├── vite.config.ts
│   └── src/
│       ├── App.tsx
│       ├── components/       # UI bileşenleri
│       ├── hooks/            # React hook'ları
│       ├── types/            # IPC tip tanımları
│       └── styles/
│           └── globals.css
├── dist/                     # Derlenmiş CLI (gitignore)
├── dist-electron/            # Derlenmiş Electron (gitignore)
├── dist-renderer/            # Derlenmiş React (gitignore)
├── dist-packages/            # Paketlenmiş uygulamalar (gitignore)
├── electron-builder.config.js
├── tsconfig.json             # CLI TypeScript yapılandırması
├── tsconfig.electron.json    # Electron TypeScript yapılandırması
└── package.json
```

---

## Lisans

MIT — Ayrıntılar için [LICENSE](LICENSE) dosyasına bakın.
