/* voice.js — 動物人聲 runtime:mp3(msedge-tts 預烤)優先;缺檔 = 不唸。
 * ★ 與 skill animal-opponent-kit/assets/voice.js 同一份(沉澱自 majiang3d src/voice.js)。
 *
 * ★ 人聲鐵律(baked-voice-commentary):絕對沒有 Web Speech fallback(smoke 會 grep src 裡不得出現 Web Speech 那個全域物件名)。
 * ★ 跟 🔊 音效同一個開關(muted() 由站方給,通常是 !sfx.on)+ 🐾 動物關掉就不出聲(站方判)。
 * ★ 一隻一個 Audio 元素重用(每句 new Audio 會累積 WebMediaPlayer,長場次被 Chrome 封鎖);不同隻可以同時出聲。
 * ★ 瀏覽器要有使用者手勢才准放音:開場就 say 會被 reject,靜默吞掉,不影響遊戲。
 *
 * 用法:const voice = createVoice({ muted: () => !sfx.on });  voice.say('cat', 'win', 200)
 * manifest.json 由 scripts/gen-voice.mjs 產,鍵 = "<animal>-<event>"、值 = "voice/<animal>-<event>.mp3"(相對站根)。
 */
export function createVoice({ root = './', muted = () => false } = {}) {
  let manifest = null
  const players = {}
  const load = async () => {
    try { const r = await fetch(root + 'voice/manifest.json'); manifest = r.ok ? await r.json() : {} } catch { manifest = {} }
    return manifest
  }
  load()
  return {
    enabled: true,
    ready() { return !!manifest },
    has(animal, event) { return !!(manifest && manifest[animal + '-' + event]) },
    /** 唸一句;delayMs 讓多隻錯開。回傳 true = 真的送去放了(靜音 / 缺檔 / 沒載到 manifest 都回 false) */
    say(animal, event, delayMs = 0) {
      if (!this.enabled || !manifest) return false
      if (muted()) return false
      const path = manifest[animal + '-' + event]
      if (!path) return false
      const go = () => {
        try {
          let a = players[animal]
          if (!a) { a = players[animal] = new Audio(); a.volume = 0.9 }
          a.pause()
          a.src = root + path
          a.currentTime = 0
          a.play().catch(() => { /* 還沒有手勢、或被系統靜音 */ })
        } catch { /* 沒有 Audio 就算了 */ }
      }
      if (delayMs > 0) setTimeout(go, delayMs); else go()
      return true
    },
  }
}
