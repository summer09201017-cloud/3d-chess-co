/* gen-voice.mjs — 把 src/voicePhrases.js 的動物唸稿用 msedge-tts(微軟神經語音,免費、烤製時要網路)預烤成 mp3。
 * ★ 與 skill animal-opponent-kit/assets/gen-voice.mjs 同一份(沉澱自 majiang3d scripts/gen-voice.mjs)。
 *
 * 產出:public/voice/<animal>-<event>.mp3 + public/voice/manifest.json;並把 public/sw.js 裡 voice:begin~voice:end 那段
 * SHELL 清單**照目錄重生**(baked-voice 0829 教訓:手抄 CORE 清單一定會漏,而且漏的壞法是靜默的 —— 只有離線那次少一句)。
 * 累加式:已有的檔跳過;逐句落盤;偶發「Stream closed」重跑一次即補齊。
 * 用法:node scripts/gen-voice.mjs        (需要 devDependency msedge-tts ^2.0.8)
 *   選項(0928 象棋家族加的,都是相對 repo 根):
 *     --phrases src/petPhrases.js   詞庫(預設 src/voicePhrases.js;站裡已有別套 voicePhrases.js 時用)
 *     --out voice                   mp3 輸出目錄(預設 public/voice;沒有 public/ 的平放站用 voice)
 *     --sw service-worker.js        要重生 voice 段的 SW(預設 public/sw.js;檔名叫 service-worker.js 的站用它)
 * sw.js 要先放好標記(SHELL 陣列裡):
 *   /* voice:begin(scripts/gen-voice.mjs 照目錄重生,不手抄) *​/
 *   /* voice:end *​/
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, copyFileSync, rmSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts'

/* 詞庫預設 ../src/voicePhrases.js;站裡已經有別的 voicePhrases.js(例如撞球家族的播報詞庫)時,
 * 用 `node scripts/gen-voice.mjs --phrases src/petPhrases.js`(或環境變數 VOICE_PHRASES)指到動物的那份 —— 檔案本身不改。 */
const arg = (name, dflt) => { const i = process.argv.indexOf(name); return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt }
const phrasesOverride = arg('--phrases', process.env.VOICE_PHRASES)
const PHRASES_URL = phrasesOverride ? pathToFileURL(resolve(phrasesOverride)).href : new URL('../src/voicePhrases.js', import.meta.url).href
const { VOICES, LINES } = await import(PHRASES_URL)

// lib 會在我們 copy 走檔案後非同步再 unlink 一次 → 吞掉這個特定錯誤
process.on('uncaughtException', (e) => {
  if (e && e.code === 'ENOENT' && e.syscall === 'unlink') return
  console.error(e); process.exit(1)
})

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = resolve(root, arg('--out', 'public/voice'))          // --out voice ⇒ 平放站(沒有 public/)
mkdirSync(OUT, { recursive: true })
const manifestPath = join(OUT, 'manifest.json')
let manifest = {}
try { manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) } catch { /* 第一次 */ }
const saveManifest = () => writeFileSync(manifestPath, JSON.stringify(manifest, null, 1) + '\n', 'utf8')

let made = 0, skipped = 0, failed = 0
for (const [animal, ev] of Object.entries(LINES)) {
  const V = VOICES[animal]
  if (!V) { console.error('✗ voicePhrases.VOICES 沒有', animal); failed++; continue }
  for (const [event, text] of Object.entries(ev)) {
    const key = `${animal}-${event}`, file = `${key}.mp3`, fp = join(OUT, file)
    if (existsSync(fp)) { manifest[key] = `voice/${file}`; saveManifest(); skipped++; continue }
    const tmpDir = join(OUT, `_tmp_${key}`)
    try {
      const tts = new MsEdgeTTS()
      await tts.setMetadata(V.voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3)
      mkdirSync(tmpDir, { recursive: true })
      const { audioFilePath } = await tts.toFile(tmpDir, text, { pitch: V.pitch, rate: V.rate })
      copyFileSync(audioFilePath, fp)          // copy 不 rename:留原檔給 lib 自己清
      try { tts.close && tts.close() } catch { /* socket 已關 */ }
      manifest[key] = `voice/${file}`
      saveManifest()
      made++
      console.log('✓', key, text)
    } catch (err) {
      failed++
      console.error('✗', key, text, String(err).slice(0, 120))
    } finally {
      try { rmSync(tmpDir, { recursive: true, force: true }) } catch { /* noop */ }
    }
  }
}

// sw.js SHELL 的 voice 段照目錄重生(沒有 sw.js 的站 —— 例如撞球家族沒做 PWA 殼層 —— 就略過)
const mp3 = readdirSync(OUT).filter((f) => f.endsWith('.mp3')).sort()
const swPath = resolve(root, arg('--sw', 'public/sw.js'))      // --sw service-worker.js ⇒ 檔名不叫 sw.js 的站
if (!existsSync(swPath)) {
  console.log(`(沒有 ${swPath},略過 SHELL 重生;voice/ 現有 ${mp3.length} 支 mp3)`)
} else {
  const sw = readFileSync(swPath, 'utf8')
  const block = '/* voice:begin(scripts/gen-voice.mjs 照目錄重生,不手抄) */\n  "./voice/manifest.json",\n' + mp3.map((f) => `  "./voice/${f}",`).join('\n') + '\n  /* voice:end */'
  const re = /\/\* voice:begin[^*]*\*\/[\s\S]*?\/\* voice:end \*\//
  if (!re.test(sw)) { console.error('🔴 ' + swPath + ' 找不到 voice:begin / voice:end 標記'); process.exit(1) }
  const next = sw.replace(re, block)
  if (next !== sw) { writeFileSync(swPath, next, 'utf8'); console.log(`sw.js SHELL voice 段重生:${mp3.length} 支 mp3`) }
  else console.log(`sw.js SHELL voice 段已是最新(${mp3.length} 支)`)
}

console.log(`done: made ${made}, skipped ${skipped}, failed ${failed}, total ${mp3.length} mp3`)
process.exit(failed ? 1 : 0)   // 明確收尾(lib 的 WebSocket 會讓 process 掛著)
