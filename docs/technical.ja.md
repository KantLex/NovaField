# NovaField 技術ガイド

[English](technical.md) · **日本語** · [繁體中文](technical.zh-Hant.md)

NovaField の内部の仕組みを説明します。ComfyUI をどう動かしているか、各機能のグラフをどう組み立てているか、
ノードパック、テスト、エージェント API、コード構成を扱います。アプリの使い方は
[README](../README.ja.md) をご覧ください。

## 技術スタック

- **アプリ：** Next.js 16（App Router、Turbopack）、React 19、Tailwind CSS 4、zustand、motion。
  UI と API ルートは、ポート 4317 で動くひとつの Next アプリにまとまっています。
- **サーバー側：** ComfyUI クライアント（`src/server/comfy.ts`）と、進行状況をブラウザへプッシュする WebSocket ハブ、
  ジョブランナー、`data/` に置く JSON のジョブストア、そしてアップロードの整形、ポスター画像、テール（末尾のフレーム）、
  映画の組み立てに使う ffmpeg/ffprobe で構成されています。
- **ノードパック：** `comfyui-novafield/`。torch と numpy だけを使う純粋な Python です。
- **テスト：** vitest（happy-dom と Testing Library）、ブラウザテストには Playwright、ノードパックには pytest を
  使います。

## NovaField での ComfyUI の使い方

### グラフはテンプレートではなくコンパイルで作る

エンジン（`src/lib/engines`）は、**ジョブスペック** から API 形式のグラフを TypeScript で組み立てます。ジョブスペックとは、
ユーザーが求めた内容を型付きで記述したものです（`src/lib/engines/specs.ts`：`ShotSpec`、`RecastSpec`、
`RestyleSpec`、`ReplaceSpec`、`PathsSpec`、`WorkflowSpec`、`ImageSpec`、`GradeSpec`）。
`src/lib/engines/index.ts` は種類ごとに、対応するコンパイラーと **ブロッカー** へ処理を振り分けます。ブロッカーは、
サーバーがそのスペックを実行できないときに、読んでわかる理由を返す関数です。

キューに入れる前に、すべてのグラフをサーバーの現在の `/object_info` と照合します
（`src/lib/comfy/validate.ts`）。ノード名、入力の型、リンクの型、列挙値（モデル、LoRA）、値の範囲を確認します。
モデルが足りない場合は、レンダリングが失敗する代わりに、読んでわかるメッセージになります。

### サーバーの機能に合わせる UI

`src/lib/engines/capabilities.ts` は接続ごとに一度 `/object_info` を読み込み、サーバーで何ができるかを割り出します。
どの MiniMax H3、Wan、画像、フレーム補間のモデルがあるか、どの NovaField ノード（とそのどの入力）があるか、といったことです。
たとえば `caps.pack.filmLooks` はサーバー自身が持つフィルムストックの一覧で、`caps.pack.filmControls` は NovaLensFilm に
0.3.0 のカラー調整項目があるかどうかを示します。UI はレンダリング時に失敗させる代わりに、何をインストールすればよいかを添えて
機能をロックし、サーバーにあるノードのバージョンが知っている入力だけを送ります。

### プリビズ（ゴーストリグ）：カメラモデルを使わないカメラ制御

`NovaGhostRig` ノードは、選んだカメラワークを灰色のワイヤーフレームの「キャリア」動画として GPU でレンダリングします。
この動画はそのまま MiniMax H3 の参照動画入力に渡され、プロンプトで H3 に、カメラの経路はなぞり、見た目は無視するよう指示します。
ブラウザのプリビズと GPU ノードは、ひとつのカメラ仕様（[contract.md](contract.md)）を共有しています。TypeScript 版と
Python 版が小数点以下 6 桁まで一致することをフィクスチャで確認しているので、画面で見たカメラワークがそのままレンダリングされます。

ノードパックがない場合は、同じプランを言葉に置き換えます。たとえば "The camera arcs 74
degrees around the subject… The main subject walks across the frame from left to right." のようになります。

### シームレスな続き撮り

「このショットの続きを撮る」は、テイクの最後の 22 フレームを（音声ごと）切り出し、`MiniMaxH3AddGuide` を通じて
次のレンダリングのフレーム 0 に固定します。動きと音声がカットをまたいで引き継がれます。シーケンスの組み立て処理が
重複したフレームを取り除くので、つなぎ目は見えません。

### 共有 GPU に配慮したクライアント

NovaField がキューをクリアしたり、やみくもに中断したりすることはありません。キャンセルするのは自分のプロンプトだけです
（待機中なら `POST /queue {delete}`、実行中なら対象を絞った `/interrupt`）。ほかの人のジョブで GPU が使用中のときは、
ヘッダーにそう表示されます。

## 機能の内部構造

### 画像（`src/lib/engines/image.ts`、`src/ui/image`）

`ImageSpec.tool` は `edit`、`upscale`、`expand` のいずれかです。

- **編集、Qwen Image Edit：** `UNETLoader` → `ModelAttentionBackend`（"pytorch attention"、ノードがある場合）→
  `ImageScaleToTotalPixels`（1 MP、lanczos、16 刻み）→ ポジティブとネガティブの `TextEncodeQwenImageEdit` →
  `ModelSamplingAuraFlow`（shift 3）→ `CFGNorm` → `KSampler`（20 ステップ、cfg 2.5）→ `VAEDecode` → `SaveImage`。
  このアテンションの上書きが重要です。`--use-sage-attention` 付きで起動したサーバーでは、これがないと Qwen Image Edit の
  出力が真っ黒になります。
- **編集、Flux Kontext：** `DualCLIPLoader`（clip_l + t5xxl）→ `FluxKontextImageScale` →
  `ReferenceLatent` → `FluxGuidance` 2.5。ネガティブにはゼロにしたものを使います。
- **拡張：** `ImagePadForOutpaint` で画像を選んだ縦横比まで広げ（`expandPadding`）、続いて新しい余白を埋めるよう
  指示して編集グラフを実行します（`expandPrompt`）。
- **アップスケール：** `ImageScale`（lanczos）で目標サイズまで拡大し（上限は約 4.2 MP、`upscaleSize`）、続いて
  デノイズを低くした Z Image Turbo のパス（8 ステップ、`res_multistep`、デノイズ `0.15 + 0.4 × creativity`）で
  細部を描き込みます。プロンプトがない場合は、後のバージョンの編集指示ではなく、元のテイク自身のプロンプト（`sceneOf`）を使います。

画像ページのバージョン履歴は、`spec.from` をたどって元の画像までさかのぼります（`rootOf`、`versions`）。

### グレード（`src/lib/engines/grade.ts`、`src/ui/grade`）

グラフは次の順に並びます。

```
LoadVideo → GetVideoComponents
  → [FrameInterpolationModelLoader + FrameInterpolate(m) → NovaShutter]   Motion
  → [LoadImage(reference) → NovaMatchColor]                                Match another shot
  → [NovaLensFilm]                                                         Look, colour, lens
  → CreateVideo(fps, audio unless speed ≠ 1) → SaveVideo
```

- ブラーを最初にかけるので、元の映像自身の色で平均化されます。マッチとルックは、そのあと最終的なフレームに適用されます。
- `interpolationFor` は、6 GB のフレーム予算から FILM の倍率（2〜8）を選びます。大きなクリップほど中間フレームは
  少なくなりますが、ブラーに足りないほど少なくはなりません。通常以上の速度でシャッターを閉じた場合はフレームを間引くだけなので、
  補間は不要です。
- `framesAtSpeed` が新しい長さを求めます。1× 以外の速度では音声が削除され、テイクにその旨が記録されます。
- `meta.engine` には実行したパックのノードが並びます。例：`NovaShutter + NovaMatchColor + NovaLensFilm`。

**ライブプレビュー。** `GradeCanvas.tsx` は NovaLensFilm の計算と CIELAB マッチを再現した WebGL シェーダーなので、
スライダーにすぐ反応します。ルックのパラメーターは `src/lib/cinema/grade.ts` にあります。パリティテストが Python の
`LOOK_PARAMS` を（`ast` で）解析し、両者が一致することを確認します。**正確に確認** は、一時停止中のフレームを実際の
ノードでレンダリングします（`src/server/gradePreview.ts`、`/api/grade/preview`）。ライブプレビューと正確な確認の差は、
平均で 1〜2 レベル以内です。

**マッチ。** 参照には、選んだテイクの中ほどのフレームを使います（`/api/jobs/[id]/frame`）。ブラウザはプレビュー用に
その Lab 統計量を測り（`src/ui/grade/labOf.ts`、`src/lib/cinema/match.ts`）、ノードは GPU で改めて測ります。

### ショット QC（`src/server/qc.ts`、`src/lib/qc.ts`、`src/ui/Qc.tsx`）

1. `checkTake` はテイクの MP4 を `nf_qc_<id>.mp4` として ComfyUI にアップロードし、
   `LoadVideo → GetVideoComponents → NovaShotQC` をキューに入れます。
2. `NovaShotQC` は出力ノードで、JSON のレポートを `{"ui": {"text": [report]}}` として返します。
3. サーバーはプロンプトの完了を待ち（`comfy.ts` の `finished()`）、`history.outputs[node].text` を読み取って、
   ジョブに `job.qc` として保存します。
4. テイクが完成するたびに、サーバーに NovaShotQC があれば、`checkQuietly` がバックグラウンドでチェックを実行します。
   `POST /api/jobs/<id>/qc` で、好きなときに実行することもできます。

`needsLook` は、スコアが 85 未満か、重大度の高い不具合を含むレポートに印を付けます。レポートの形式は
[contract.md](contract.md#novashotqc-040) にあります。

## ComfyUI-NovaField ノードパック

`comfyui-novafield/` は、Python の追加依存がない（torch と numpy のみ）カスタムノードパックです。
すべての入力はパック自身の [README](../comfyui-novafield/README.md) に、共通の計算は
[contract.md](contract.md) にまとめてあります。

| ノード | 機能 | 追加されたバージョン |
|---|---|---|
| `NovaGhostRig` | カメラ経路の JSON → ワイヤーフレームのモーションガイド動画（ステージ、人物、星空、または写真の 2.5D パララックス） | 0.2 |
| `NovaLensFilm` | GPU でのフィルムエミュレーション：18 種類のストック、カラー調整、グレイン、ハレーション、ビネット、色収差、ゲートウィーブ、アナモルフィックのストリーク | 0.2（ストックとカラー調整の追加は 0.3） |
| `NovaBoxTrackMask` | キーフレームを打った矩形または楕円 → ぼかしたマスク動画と、Wan VACE が想定する灰色で塗りつぶしたコントロール動画 | 0.2 |
| `NovaContactSheet` | フレーム → コンタクトシート画像 | 0.2 |
| `NovaMatchColor` | 色の統一：クリップの CIELAB 統計量を参照画像のものに合わせます | 0.4 |
| `NovaShutter` | 補間したフレームによるシャッターのモーションブラーと速度変更 | 0.4 |
| `NovaShotQC` | フリーズしたフレーム、ジャンプ、ちらつき、ピンボケのフレーム、露出のチェック → JSON レポート | 0.4 |

アプリは GitHub リポジトリから ComfyUI Manager 経由でパックをインストールします（`src/server/nodes.ts`、
`src/server/packs.ts`）。Comfy Registry にはまだ登録されていません。新しいバージョンのリリース手順は
[releasing-nodes.md](releasing-nodes.md) をご覧ください。

## モデル

アプリが探すファイル名は次のとおりです（`src/lib/engines/capabilities.ts`）。

| 機能 | ファイル |
|---|---|
| MiniMax H3 のショット | `minimax_h3_fl2va_pruned_int8_convrot`、`minimax_h3_ref2va_pruned_int8_convrot`、Turbo LoRA の `minimax_h3_fl2v_turbo_8step_v1.0_comfyui_bf16` と `minimax_h3_ref2v_turbo_8step_v1.0_768p_comfyui_bf16`、`qwen3vl_32b_minimax_h3_nvfp4_awq`、`minimax_h3_video_vae_fp16`、`minimax_h3_audio_vae_fp32` |
| Wan（リキャスト、リスタイル、置き換え） | `wan2.1_vace_14B_fp16`、`umt5_xxl_fp8_e4m3fn_scaled`、`wan_2.1_vae`、`Wan21_CausVid_14B_T2V_lora_rank32` |
| Wan（モーションパス） | `wan2.1_i2v_480p_14B_fp16`、`clip_vision_h` |
| Qwen Image Edit | `qwen_image_edit_fp8_e4m3fn`、`qwen_2.5_vl_7b_fp8_scaled`、`qwen_image_vae` |
| Flux Kontext | `flux1-dev-kontext_fp8_scaled`、`clip_l`、`t5xxl_fp8_e4m3fn_scaled`、`ae` |
| アップスケール | `z_image_turbo_bf16`、`qwen_3_4b`、`ae` |
| 48 fps、シャッター、速度 | `film_net_fp16` |

拡張子はすべて `.safetensors` です。足りないものがあっても、それを必要とする機能がロックされるだけです。

## 実行・テスト・チェック

```bash
pnpm install
```

```bash
pnpm dev
```

`pnpm dev:dry` は `NOVAFIELD_DRY_RUN=1` を設定します。アプリはサーバーのノード一覧を読み込み、すべてのグラフを検証しますが、
レンダリングはプレースホルダーの映像を使ってローカルでシミュレートされるため、GPU のキューには何も入りません。

**接続設定** は `data/connection.json` に保存され（キーも含みます。読み取れるのは本人だけです）、`.env.local` の
`COMFY_URL` / `COMFY_API_KEY` より優先されます。これらの変数も初期値としては引き続き使えます（`.env.example` を参照）。
テイクのレンダリング中に、NovaField がサーバーを切り替えることはありません。

チェック：

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

- `pnpm test` はアプリのユニットテストとコンポーネントテストを実行します。実際の `data/` フォルダには一切触れません。
- `pnpm e2e` は偽の ComfyUI（`e2e/fake-comfy.ts`）と、一時的なデータフォルダを使う開発サーバーを起動し、
  スタジオでテイクを作ってライブラリに入ることを確認します。
- パックのテストは、TypeScript のテストが読むカメラのフィクスチャも書き出します。再生成するには、`comfyui-novafield` で
  `uv run --python 3.12 --with torch --with numpy python tests/make_fixtures.py` を実行します。Linux と macOS の
  数学ライブラリでは丸め方がわずかに異なるため、フィクスチャのチェックでは浮動小数点数の末尾の桁の違いを許容しています。

### 翻訳

インターフェースは英語と 10 の言語に対応しています（`src/i18n/locales`）。UI の文字列は `tr()`、`toast()`、`say()` を
通して扱い、`scripts/i18n-keys.mjs` がそれらを抽出します。

```bash
node scripts/i18n-add.mjs strings.json
```

```bash
node scripts/i18n-add.mjs --missing
```

1 つ目は、英語の各文字列とその翻訳を対応させた JSON ファイルから、すべての言語の文字列を一度に追加・更新します。
2 つ目は、ある言語に足りない文字列を一覧表示します。

## エージェント：MCP サーバーと CLI

AI エージェント（任意の MCP クライアント）は、ローカルの HTTP API を通じて実行中のアプリを
操作できます。先にアプリを起動し（`pnpm dev`）、続けてサーバーを登録します。

```bash
pnpm novafield setup
```

サーバーの起動コマンドと、多くの MCP クライアントが受け付ける `mcpServers` JSON が、Node とこのチェックアウトへの
絶対パス付きで表示されます。MCP クライアントはシェルの PATH を引き継がず、別のフォルダから
サーバーを起動するため、パスを指定しない `pnpm` はそこでは見つからないことがよくあります。別のアドレスで動くアプリに
ツールを向けるには、実行前に `NOVAFIELD_URL` を設定してください（デフォルトは `http://localhost:4317`）。
このフォルダ内では、`pnpm mcp` でサーバーを手動で起動することもできます。

| ツール | 機能 |
|---|---|
| `status` | サーバー、GPU、キュー、API キー、インストール済みのエンジン |
| `list_engines` | MiniMax H3 と、読み込んだすべてのワークフロー。ローカルか API（`paid`）かの区別と、フィールドの役割付き |
| `plan_shot` | レンダリングせずにショットをコンパイルして事前チェックします：問題点、長さ、サイズ、料金。無料 |
| `generate` | ショットをレンダリングします（`continue_from` はテイクの最後のフレームから続けます。`smooth` で 48 fps にします）。`max_credits` が必要 |
| `run_workflow` | 読み込んだワークフローを、フィールドの役割（`prompt`、`image`、`seed`…）で値を指定して実行します。`plan_only` で事前チェックのみ。実行には `max_credits` が必要 |
| `find_workflows` / `import_workflow` | ComfyUI のテンプレートライブラリと保存済みワークフローを検索し、ひとつをアプリ（とスタジオのモデル）として読み込みます |
| `take_frame` | テイクのフレーム（最後、または任意の時点）を、キーフレーム、サムネイル、スチル用の画像として保存します |
| `get_take` / `list_takes` | テイクの状態とファイル（完了を待つこともできます）。プロジェクト、状態、スター、語句で絞り込んだテイクの一覧 |
| `cancel_take` | NovaField 自身のテイクをキャンセルします。共有サーバー上のほかのプロンプトには一切触れません |
| `list_assets` / `register_asset` | キャストとアセットライブラリ。キャラクターを画像付きで追加します |
| `list_projects` / `organise_takes` | テイクをプロジェクトに移動し（指定があればプロジェクトを作成します）、スターを付けます |
| `get_edit` / `set_edit` | プロジェクトのシーケンスエディターのタイムライン：イン点・アウト点と、カットまたはディゾルブを持つクリップ |
| `assemble_film` | このマシン上の ffmpeg で編集を 1 本の MP4 にまとめます（GPU もクレジットも不要）。`soundtrack` を下に敷くこともできます |
| `recast` | 変身：動きとカメラはそのままに、クリップの人物をキャラクターに差し替えます |
| `restyle` | 変身：クリップをショットごとに新しいルックで描き直します |
| `replace_object` | 変身：物を枠で追跡し、別のものに変えます |
| `animate_still` | 変身：描いたパスに沿って静止画を動かします。カメラのようなフレームの動きも付けられます |

リソース：`novafield://camera/moves`（すべてのカメラワーク ID、フレーミング、レンズ、ライティング、フィルムルック、
カメラワークの重ね方やリグの書き方）、`novafield://camera/contract`（`docs/contract.md`）、
`novafield://specs`（ジョブスペックの型）。

**スキル。** `skills/` には、これらのツールを使って作品をまるごと作る方法をエージェントに教えるプレイブックが入っています：
`short-drama`、`music-video`、`script-to-film`、`product-spot`、`ad-campaign`、`social-series`、
`trailer`、`one-take`、`storyboard-animatic`、`photo-to-video`、`character-sheet`、`lookbook`、
`henshin`、`comfy-workflows`、`score-and-voice`、そしてベースとなる `novafield-director`。
`pnpm novafield setup` は、これらの場所も表示します。詳しくは
[skills/README.md](../skills/README.md) をご覧ください。

**クレジットガード。** `generate`、`run_workflow` と変身のツールは、エージェントが `max_credits` を渡さない限り
何もキューに入れず、事前チェックの料金がその値を超える可能性があるときは必ず拒否します。料金が範囲で示される場合は上限で判定し、
複数のテイクは合計し、料金の上限を決められない有料ノード（数値がない、またはトークンや秒数で課金される）はその場で拒否します。
アプリもキューに入れる前に上限を改めて確認します（`maxCredits` 付きの `POST /api/jobs` は 402 を返します）。
ローカル GPU での処理だけに限るなら `max_credits: 0` を使ってください。エージェントには、まず計画と料金を見せて
本人の承認を得るよう指示してあります。

同じクライアントが CLI（`src/agent/cli.ts`）の土台にもなっています。CLI は MCP ツールでできることすべてに加えて、
画像、グレード、ショット QC も扱えます。レンダリングするコマンドはすべて、`--max-credits` を受け取るまでは計画を立てて
料金を表示するだけです（0 = ローカル GPU のみ）。この点はツールとまったく同じです。

| グループ | コマンド |
|---|---|
| サーバー | `status`、`engines [--fields]`、`moves`（カメラの語彙） |
| 作成 | `shot`、`recast`、`restyle`、`replace`、`animate`、`image edit\|upscale\|expand`、`grade`、`run <workflow>` |
| チェック | `qc <take>`：スコアと、各不具合とその時刻 |
| ライブラリ | `takes`、`take`、`cancel`、`frame`、`move`、`star`、`projects`、`assets`、`asset` |
| ワークフロー | `find-workflows`、`import <file \| template:<name> \| saved:<path>>` |
| 編集 | `edit`、`edit set <clip>…`、`film [--soundtrack]`、`setup` |

画像とクリップの指定方法はどこでも共通です：`asset:<id>`、`take:<id>`（その 1 フレームを指すなら `@<seconds>` を付けます）、
ファイルパス、またはテイクやアセットの ID そのもの。レンダリングの共通オプションは `--project`、
`--wait`（進行状況をライブ表示）、`--save <file|dir>`（結果をダウンロード）、`--json` です。

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

枠はフレームに対する割合で表した `x,y,w,h` です（動く物なら `@seconds` を付けます）。パスは `"x,y x,y"` で、
必要に応じて `@start-end` と `:ease` を付けます。編集のクリップは `<take>[:in-out][:cut|dissolve]` で、末尾に `!` を
付けるとそのクリップをミュートします。`pnpm novafield --help` ですべてのオプションを確認できます。

## データ

NovaField が保存するものはすべて `data/`（git の管理外）か、設定 → 保存場所 で選んだフォルダにあります。

| パス | 内容 |
|---|---|
| `jobs.json` | すべてのテイク：スペック、状態、ファイル、QC レポート |
| `projects.json`, `sequences.json` | プロジェクトと、プロジェクトごとにひとつの編集（`GET`/`PUT /api/sequences/<project id or "all">`） |
| `assets.json`, `assets/` | アセットライブラリとそのファイル |
| `media/`, `films/`, `uploads/` | レンダリング結果、組み立てた映画、アップロード |
| `workflows/` | 読み込んだワークフローとそのフォーム |
| `connection.json` | サーバーと API キー |
| `storage.json` | メディアフォルダの保存場所 |

エディターとエージェントは `sequences.json` を共有しているので、開いているエディターもリアルタイムに更新されます。

## コード構成

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
