# NovaField 技術指南

[English](technical.md) · [日本語](technical.ja.md) · **繁體中文**

NovaField 的內部運作：它如何驅動 ComfyUI、每個功能的節點圖如何建構、節點包、測試、代理 API
以及程式碼結構。應用程式的使用方式請參閱 [README](../README.zh-Hant.md)。

## 技術堆疊

- **應用程式：** Next.js 16（App Router、Turbopack）、React 19、Tailwind CSS 4、zustand、motion。
  介面和 API 路由都在同一個 Next 應用程式中，使用 4317 連接埠。
- **伺服器端：** 一個 ComfyUI 用戶端（`src/server/comfy.ts`），搭配把進度推送到瀏覽器的 WebSocket
  中樞、一個工作執行器、存放在 `data/` 中的 JSON 工作儲存區，以及用來轉換上傳檔案格式、產生封面圖、
  擷取結尾片段和組合影片的 ffmpeg/ffprobe。
- **節點包：** `comfyui-novafield/`，純 Python，只依賴 torch 和 numpy。
- **測試：** vitest 搭配 happy-dom 與 Testing Library，瀏覽器測試使用 Playwright，節點包使用 pytest。

## NovaField 如何使用 ComfyUI

### 節點圖是編譯出來的，不是套用範本

引擎（`src/lib/engines`）用 TypeScript 從**工作規格**建構 API 格式的節點圖。工作規格是對使用者需求的
型別化描述（`src/lib/engines/specs.ts`：`ShotSpec`、`RecastSpec`、`RestyleSpec`、`ReplaceSpec`、
`PathsSpec`、`WorkflowSpec`、`ImageSpec`、`GradeSpec`）。`src/lib/engines/index.ts` 會把每一種規格
分派給對應的編譯器和**阻擋器**；阻擋器是一個函式，當伺服器無法執行該規格時，會回傳一段看得懂的原因。

送入佇列之前，每張節點圖都會對照伺服器即時的 `/object_info` 檢查一遍（`src/lib/comfy/validate.ts`）：
節點名稱、輸入型別、連結型別、列舉值（模型、LoRA）和數值範圍。缺少模型會變成一則看得懂的訊息，
而不是一次失敗的渲染。

### 依伺服器能力調整的介面

`src/lib/engines/capabilities.ts` 每次連線時讀取一次 `/object_info`，從中推算出伺服器能做什麼：
有哪些 MiniMax H3、Wan、圖片和插幀模型，以及有哪些 NovaField 節點（和這些節點有哪些輸入）。
例如 `caps.pack.filmLooks` 是伺服器自己的膠片清單，`caps.pack.filmControls` 則表示 NovaLensFilm
是否具備 0.3.0 的色彩控制項。介面會鎖定功能並說明要安裝什麼，而不是在渲染時才失敗；
送出的輸入也只限伺服器上的節點版本認得的項目。

### 預演（ghost rig）：不需要攝影機模型的攝影機控制

`NovaGhostRig` 節點會在 GPU 上把選定的運鏡渲染成一段灰色線框的「載體」影片。這段影片直接送進
MiniMax H3 的參考影片輸入，並以提示詞要求 H3 複製它的攝影機路徑、忽略它的外觀。瀏覽器中的預演和
GPU 節點共用同一份攝影機規格（[contract.md](contract.md)）。測試資料會檢查 TypeScript 與 Python
兩個版本的結果一致到小數點後 6 位，所以你看到的運鏡就是實際渲染的運鏡。

沒有節點包時，同樣的運鏡規劃會轉換成文字，例如："The camera arcs 74
degrees around the subject… The main subject walks across the frame from left to right."

### 無縫延續

「延續這個鏡頭」會擷取一個鏡次最後的 22 格（連同聲音），並透過 `MiniMaxH3AddGuide` 把它們固定在
下一次渲染的第 0 格。動作和音訊都會延續過剪接點。序列組合器會移除重複的畫格，讓接點看不出來。

### 在共用 GPU 上守規矩的用戶端

NovaField 從不清空佇列，也不會盲目中斷。它只取消自己的提示（等待中時用 `POST /queue {delete}`；
執行中時用指定目標的 `/interrupt`）。當 GPU 正在處理別人的工作時，頂部會顯示出來。

## 功能內部運作

### 圖片（`src/lib/engines/image.ts`、`src/ui/image`）

`ImageSpec.tool` 是 `edit`、`upscale` 或 `expand`。

- **編輯，Qwen Image Edit：** `UNETLoader` → `ModelAttentionBackend`（"pytorch attention"，
  在該節點存在時）→ `ImageScaleToTotalPixels`（1 MP、lanczos、以 16 為單位）→
  `TextEncodeQwenImageEdit` 正向與負向 → `ModelSamplingAuraFlow`（shift 3）→ `CFGNorm` →
  `KSampler`（20 步、cfg 2.5）→ `VAEDecode` → `SaveImage`。
  注意力機制的覆寫很重要：在以 `--use-sage-attention` 啟動的伺服器上，少了它 Qwen Image Edit
  會渲染出全黑的畫面。
- **編輯，Flux Kontext：** `DualCLIPLoader`（clip_l + t5xxl）→ `FluxKontextImageScale` →
  `ReferenceLatent` → `FluxGuidance` 2.5，負向提示則歸零。
- **擴展：** `ImagePadForOutpaint` 把圖片加寬到選定的比例（`expandPadding`），接著執行編輯節點圖，
  並附上填滿新空間的指示（`expandPrompt`）。
- **放大：** `ImageScale`（lanczos）縮放到目標尺寸，上限約 4.2 MP（`upscaleSize`），接著以低降噪
  的 Z Image Turbo 再跑一次（8 步、`res_multistep`、降噪 `0.15 + 0.4 × creativity`）來畫出細節。
  沒有提示詞時，它會使用最初那個鏡次自己的提示詞（`sceneOf`），而不是後來某個版本的編輯指示。

圖片頁面的版本紀錄會沿著 `spec.from` 一路追溯回最初的圖片（`rootOf`、`versions`）。

### 調色（`src/lib/engines/grade.ts`、`src/ui/grade`）

節點圖依序為：

```
LoadVideo → GetVideoComponents
  → [FrameInterpolationModelLoader + FrameInterpolate(m) → NovaShutter]   Motion
  → [LoadImage(reference) → NovaMatchColor]                                Match another shot
  → [NovaLensFilm]                                                         Look, colour, lens
  → CreateVideo(fps, audio unless speed ≠ 1) → SaveVideo
```

- 模糊排在最前面，所以它平均的是來源本身的色彩；接著配合與風格才套用到最終的畫格上。
- `interpolationFor` 會依 6 GB 的畫格預算挑選 FILM 的倍數（2 到 8）：大的片段會得到較少的中間畫格，
  但絕不會少到無法產生模糊。在正常或更高速度下，關閉的快門只會丟棄畫格，所以不需要插幀。
- `framesAtSpeed` 算出新的長度；只要速度不是 1×，聲音就會被移除，並在鏡次上附註說明。
- `meta.engine` 列出實際執行過的節點包節點，例如 `NovaShutter + NovaMatchColor + NovaLensFilm`。

**即時預覽。** `GradeCanvas.tsx` 是一個 WebGL 著色器，複製了 NovaLensFilm 的運算和 CIELAB 配合，
所以滑桿會即時反應。`src/lib/cinema/grade.ts` 存放風格參數；一項一致性測試會（透過 `ast`）解析
Python 的 `LOOK_PARAMS`，檢查兩邊是否一致。**精確檢查**會用真正的節點渲染暫停的那一格
（`src/server/gradePreview.ts`、`/api/grade/preview`）；即時預覽和精確結果平均相差在 1–2 個色階以內。

**配合。** 參考畫面取自所選鏡次中段的一格（`/api/jobs/[id]/frame`）。瀏覽器會測量它的 Lab 統計值
（`src/ui/grade/labOf.ts`、`src/lib/cinema/match.ts`）用於預覽；節點則在 GPU 上重新測量一次。

### 鏡頭品檢（`src/server/qc.ts`、`src/lib/qc.ts`、`src/ui/Qc.tsx`）

1. `checkTake` 把鏡次的 MP4 以 `nf_qc_<id>.mp4` 上傳到 ComfyUI，並把
   `LoadVideo → GetVideoComponents → NovaShotQC` 送入佇列。
2. `NovaShotQC` 是一個輸出節點：它以 `{"ui": {"text": [report]}}` 回傳 JSON 報告。
3. 伺服器等待這個提示完成（`comfy.ts` 中的 `finished()`），讀取
   `history.outputs[node].text`，並以 `job.qc` 存到工作上。
4. 每個鏡次完成後，只要伺服器有 NovaShotQC，`checkQuietly` 就會在背景執行檢查。
   `POST /api/jobs/<id>/qc` 則可以隨時手動執行。

`needsLook` 會標記分數低於 85 或含有高嚴重度問題的報告。報告格式請參閱
[contract.md](contract.md#novashotqc-040)。

## ComfyUI-NovaField 節點包

`comfyui-novafield/` 是一個不需要額外 Python 相依套件（只用 torch 和 numpy）的自訂節點包。
它自己的 [README](../comfyui-novafield/README.md) 記載了每一個輸入；共用的數學則在
[contract.md](contract.md) 中。

| 節點 | 用途 | 起始版本 |
|---|---|---|
| `NovaGhostRig` | 攝影機路徑 JSON → 線框運動引導影片（舞台、人形、星空，或照片的 2.5D 視差） | 0.2 |
| `NovaLensFilm` | 在 GPU 上模擬膠片：18 種膠片、色彩控制、顆粒、光暈、暗角、色散、片門晃動、變形寬銀幕光條 | 0.2（更多膠片與色彩控制 0.3） |
| `NovaBoxTrackMask` | 關鍵影格化的方框或橢圓 → 羽化遮罩影片，以及 Wan VACE 需要的灰色填充控制影片 | 0.2 |
| `NovaContactSheet` | 畫格 → 印樣圖片 | 0.2 |
| `NovaMatchColor` | 色彩連戲：把片段的 CIELAB 統計值移到參考圖片的統計值上 | 0.4 |
| `NovaShutter` | 從插幀畫格產生快門動態模糊和變速 | 0.4 |
| `NovaShotQC` | 檢查凍結畫格、跳動、閃爍、失焦畫格和曝光 → JSON 報告 | 0.4 |

應用程式會透過 ComfyUI Manager 從 GitHub 儲存庫安裝節點包（`src/server/nodes.ts`、
`src/server/packs.ts`）。它目前還沒有上架 Comfy Registry。要發布新版本，請參閱
[releasing-nodes.md](releasing-nodes.md)。

## 模型

應用程式會尋找的檔案名稱（`src/lib/engines/capabilities.ts`）：

| 功能 | 檔案 |
|---|---|
| MiniMax H3 鏡頭 | `minimax_h3_fl2va_pruned_int8_convrot`、`minimax_h3_ref2va_pruned_int8_convrot`、Turbo LoRA `minimax_h3_fl2v_turbo_8step_v1.0_comfyui_bf16` 和 `minimax_h3_ref2v_turbo_8step_v1.0_768p_comfyui_bf16`、`qwen3vl_32b_minimax_h3_nvfp4_awq`、`minimax_h3_video_vae_fp16`、`minimax_h3_audio_vae_fp32` |
| Wan（換角、換風格、替換） | `wan2.1_vace_14B_fp16`、`umt5_xxl_fp8_e4m3fn_scaled`、`wan_2.1_vae`、`Wan21_CausVid_14B_T2V_lora_rank32` |
| Wan（運動路徑） | `wan2.1_i2v_480p_14B_fp16`、`clip_vision_h` |
| Qwen Image Edit | `qwen_image_edit_fp8_e4m3fn`、`qwen_2.5_vl_7b_fp8_scaled`、`qwen_image_vae` |
| Flux Kontext | `flux1-dev-kontext_fp8_scaled`、`clip_l`、`t5xxl_fp8_e4m3fn_scaled`、`ae` |
| 放大 | `z_image_turbo_bf16`、`qwen_3_4b`、`ae` |
| 48 fps、快門、速度 | `film_net_fp16` |

全部都是 `.safetensors`。缺少任何一個，只會鎖住需要它的功能。

## 執行、測試與檢查

```bash
pnpm install
```

```bash
pnpm dev
```

`pnpm dev:dry` 會設定 `NOVAFIELD_DRY_RUN=1`：應用程式仍會讀取伺服器的節點清單並驗證每張節點圖，
但渲染改在本機以替代影片模擬，所以不會有任何工作送進 GPU 的佇列。

**連線設定**儲存在 `data/connection.json`（包含金鑰，只有你能讀取），並取代 `.env.local` 中的
`COMFY_URL` / `COMFY_API_KEY`；後兩者仍可作為初始值使用（請參閱 `.env.example`）。
有鏡次正在渲染時，NovaField 不會切換伺服器。

檢查：

```bash
pnpm test
```

```bash
pnpm exec tsc --noEmit
```

```bash
pnpm lint
```

```bash
pnpm e2e
```

```bash
cd comfyui-novafield && uv run --python 3.12 --with torch --with numpy --with pytest pytest -q
```

- `pnpm test` 執行應用程式的單元測試和元件測試。它們絕不會碰到真正的 `data/` 資料夾。
- `pnpm e2e` 會啟動一個假的 ComfyUI（`e2e/fake-comfy.ts`）和一個使用暫存資料資料夾的開發伺服器，
  然後在攝影棚中做出一個鏡次，並檢查它是否出現在媒體庫中。
- 節點包的測試也會寫出 TypeScript 測試要讀取的攝影機測試資料。要重新產生，請在
  `comfyui-novafield` 中執行 `uv run --python 3.12 --with torch --with numpy python tests/make_fixtures.py`。
  測試資料的檢查容許浮點數在最後幾位有差異，因為 Linux 和 macOS 的數學函式庫捨入方式略有不同。

### 翻譯

介面提供英文以及另外 10 種語言（`src/i18n/locales`）。介面字串都經過 `tr()`、`toast()` 和 `say()`；
`scripts/i18n-keys.mjs` 會把它們擷取出來。

```bash
node scripts/i18n-add.mjs strings.json
```

```bash
node scripts/i18n-add.mjs --missing
```

第一個指令從一個 JSON 檔案（把每個英文字串對應到它的各語言翻譯）一次新增或更新所有語言的字串。
第二個指令列出某個語言還缺少哪些字串。

## 代理：MCP 伺服器與 CLI

AI 代理（任何 MCP 用戶端）可以透過執行中應用程式的本機 HTTP API 來操作它。
先啟動應用程式（`pnpm dev`），再註冊伺服器：

```bash
pnpm novafield setup
```

它會印出伺服器的啟動指令，以及大多數 MCP 用戶端都接受的 `mcpServers` JSON，其中包含 Node 和這份
程式碼的絕對路徑。MCP 用戶端啟動伺服器時不會帶入你 shell 的 PATH，
而且是從另一個資料夾啟動，所以在那裡常常找不到單純的 `pnpm`。執行前設定 `NOVAFIELD_URL`，
就能讓這些工具改連到其他位址上的應用程式（預設為 `http://localhost:4317`）。在這個資料夾中，
`pnpm mcp` 也可以手動啟動伺服器。

| 工具 | 用途 |
|---|---|
| `status` | 伺服器、GPU、佇列、API 金鑰、已安裝的引擎 |
| `list_engines` | MiniMax H3 以及每一個匯入的工作流程，標示為本機或 API（`paid`），並附上欄位角色 |
| `plan_shot` | 編譯並預檢一個鏡頭但不渲染：問題、長度、尺寸、價格。免費 |
| `generate` | 渲染一個鏡頭（`continue_from` 從某個鏡次的最後幾格延續；`smooth` 讓它成為 48 fps）。需要 `max_credits` |
| `run_workflow` | 依欄位角色（`prompt`、`image`、`seed`…）執行匯入的工作流程；`plan_only` 只做預檢。執行時需要 `max_credits` |
| `find_workflows` / `import_workflow` | 搜尋 ComfyUI 的範本庫和已儲存的工作流程；把其中一個匯入為應用程式（以及攝影棚中的模型） |
| `take_frame` | 把鏡次的一格（最後一格或任何時間點）存成圖片，用於關鍵影格、縮圖或靜態畫面 |
| `get_take` / `list_takes` | 某個鏡次的狀態和檔案（可選擇等待它完成）；依專案、狀態、星號、文字篩選鏡次 |
| `cancel_take` | 取消 NovaField 自己的某個鏡次；共用伺服器上的其他提示永遠不會被動到 |
| `list_assets` / `register_asset` | 角色與素材庫；連同圖片新增一個角色 |
| `list_projects` / `organise_takes` | 把鏡次移到某個專案（需要時建立專案），加上星號 |
| `get_edit` / `set_edit` | 某個專案在序列剪輯器中的時間軸：含入點/出點以及剪接或溶接的片段 |
| `assemble_film` | 在這台電腦上用 ffmpeg 把剪輯組成一個 MP4（不用 GPU、不花點數），可選擇墊上 `soundtrack` |
| `recast` | 變身：把片段中的人物換成某個角色，保留動作和運鏡 |
| `restyle` | 變身：逐鏡頭以新的風格重新渲染片段 |
| `replace_object` | 變身：用方框追蹤某個物件，並把它換成別的東西 |
| `animate_still` | 變身：讓靜態圖沿著畫出的路徑動起來，可選擇加上類似攝影機的畫面移動 |

資源：`novafield://camera/moves`（每個運鏡 id、景別、鏡頭、光線、膠片風格，以及如何疊加運鏡或撰寫
攝影機路徑）、`novafield://camera/contract`（`docs/contract.md`）和 `novafield://specs`（工作規格型別）。

**技能。** `skills/` 存放操作手冊，教代理在這些工具之上完成整部作品：
`short-drama`、`music-video`、`script-to-film`、`product-spot`、`ad-campaign`、`social-series`、
`trailer`、`one-take`、`storyboard-animatic`、`photo-to-video`、`character-sheet`、`lookbook`、
`henshin`、`comfy-workflows`、`score-and-voice`，以及基礎的 `novafield-director`。
`pnpm novafield setup` 會印出它們的位置；請參閱
[skills/README.md](../skills/README.md)。

**點數防護。** 除非代理傳入 `max_credits`，否則 `generate`、`run_workflow` 和變身工具一律拒絕把任何工作
送入佇列；只要預檢價格可能超過這個上限，它們也會拒絕：價格區間以最高值檢查，多個鏡次會加總計算，
而無法確定價格上限的付費節點（沒有數字，或按 token 或秒數計費）會直接被拒絕。應用程式在送入佇列前
會再檢查一次上限（帶有 `maxCredits` 的 `POST /api/jobs` 會回應 402）。只使用本機 GPU 時，
請用 `max_credits: 0`。代理會被要求先讓使用者看過計畫和價格，並取得同意。

CLI（`src/agent/cli.ts`）背後也是同一個用戶端。MCP 工具能做的它都能做，另外還支援圖片、調色和鏡頭品檢。
每個會渲染的指令在收到 `--max-credits`（0 = 只用本機 GPU）之前，都只會做規劃並印出價格，和工具完全相同。

| 群組 | 指令 |
|---|---|
| 伺服器 | `status`、`engines [--fields]`、`moves`（攝影機詞彙） |
| 製作 | `shot`、`recast`、`restyle`、`replace`、`animate`、`image edit\|upscale\|expand`、`grade`、`run <workflow>` |
| 檢查 | `qc <take>`：分數，以及每個瑕疵和它的時間點 |
| 媒體庫 | `takes`、`take`、`cancel`、`frame`、`move`、`star`、`projects`、`assets`、`asset` |
| 工作流程 | `find-workflows`、`import <file \| template:<name> \| saved:<path>>` |
| 剪輯 | `edit`、`edit set <clip>…`、`film [--soundtrack]`、`setup` |

圖片和片段在任何地方的寫法都相同：`asset:<id>`、`take:<id>`（加上 `@<seconds>` 表示其中一格）、
檔案路徑，或單純的鏡次或素材 id。共用的渲染選項：`--project`、`--wait`（顯示即時進度）、
`--save <file|dir>`（下載結果）和 `--json`。

```bash
pnpm --silent novafield shot "a lighthouse keeper climbs the stairs" --move crane_up --lens 35
```

```bash
pnpm --silent novafield shot "a lighthouse keeper climbs the stairs" --move push_in --lens 35 --max-credits 20 --wait
```

```bash
pnpm --silent novafield recast take:a1b2c3d4 --character asset:c0ffee00 --quality studio --max-credits 0 --wait --save out/
```

```bash
pnpm --silent novafield restyle e5f6a7b8 --style "hand-painted anime" --style-picture take:9a8b7c6d --max-credits 0
```

```bash
pnpm --silent novafield replace e5f6a7b8 --box 0.4,0.2,0.2,0.6 --box 0.5,0.2,0.2,0.6@3 --becomes "a golden retriever" --max-credits 0
```

```bash
pnpm --silent novafield animate take:e5f6a7b8@1 --path "0.45,0.5 0.6,0.5@0.1-0.9:smooth" --frame-move push_in:0.15 --max-credits 0
```

```bash
pnpm --silent novafield image edit asset:c0ffee00 "add a wide straw sun hat" --max-credits 0 --wait
```

```bash
pnpm --silent novafield grade 1f2e3d4c --look cinestill_800t --shutter 180 --speed 0.5 --match 5b6c7d8e --max-credits 0
```

```bash
pnpm --silent novafield run 4b5c6d7e --role prompt="a fox at dusk" --file image=./fox.png --max-credits 0
```

```bash
pnpm --silent novafield qc 1f2e3d4c
```

```bash
pnpm --silent novafield edit set e5f6a7b8:0.5-6 1f2e3d4c:0-8:dissolve --project "Night Market"
```

```bash
pnpm --silent novafield film --project "Night Market" --title "Cut 1" --soundtrack ./score.mp3 --mix under --save out/
```

方框是以畫面比例表示的 `x,y,w,h`（移動中的物件加上 `@seconds`），路徑是 `"x,y x,y"`，
可加上選用的 `@start-end` 和 `:ease`，剪輯片段則是 `<take>[:in-out][:cut|dissolve]`
（結尾加上 `!` 會把該片段靜音）。`pnpm novafield --help` 會列出所有選項。

## 資料

NovaField 保存的所有東西都在 `data/` 中（不納入 git），或在設定 → 儲存空間中選擇的資料夾裡：

| 路徑 | 內容 |
|---|---|
| `jobs.json` | 每個鏡次：它的規格、狀態、檔案、品檢報告 |
| `projects.json`、`sequences.json` | 專案，以及每個專案的一份剪輯（`GET`/`PUT /api/sequences/<project id or "all">`） |
| `assets.json`、`assets/` | 素材庫及其檔案 |
| `media/`、`films/`、`uploads/` | 渲染結果、組合好的影片、上傳檔案 |
| `workflows/` | 匯入的工作流程及其表單 |
| `connection.json` | 伺服器和 API 金鑰 |
| `storage.json` | 媒體資料夾的位置 |

剪輯器和代理共用 `sequences.json`，所以開啟中的剪輯器會即時更新。

## 程式碼結構

```
src/lib/comfy        graph builder, preflight validator, pricing and the credit budget
src/lib/cinema       camera math (shared contract), moves, film looks, grade and match maths
src/lib/engines      spec → graph compilers (H3, Wan, image, grade), capabilities, sizing, prompts
src/lib/workflows    importing ComfyUI workflows and building their forms
src/lib/qc.ts        Shot QC report types and labels
src/server           ComfyUI client, WebSocket hub, job runner, job store, QC, storage, ffmpeg helpers
src/app              pages and API routes
src/ui               monitor, previs, Studio panels, Image, Grade, Henshin editors, graph editor, takes
src/i18n             translations
src/agent            HTTP client, MCP server and CLI for agents
comfyui-novafield    the custom node pack
e2e                  the Playwright test and a fake ComfyUI
scripts              translation tools, node pack release
skills               agent playbooks
samples              a demo previs clip, its camera path and a Blender exporter
docs                 this guide, the app ⇄ node pack contract, releasing the pack
```
