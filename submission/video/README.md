# The demo video

A 2:59 explainer (1920×1080, 30 fps) recorded from the running app. It has an intro, ten scenes and a closing card, with a Mandarin narration over a quiet music bed.

Captions are in Chinese with English underneath. The permission ladder (直接办 / 需确认 / 需验证) lights the rung each step needs, and a strip shows which feature is on screen. The phone zooms in on key moments.

The video is shown faster than real time in places, and it says so where it matters:
- Each wait for the model is cut to about a second, and a chip marks it: "AI 正在规划 / thinking, shown 5× faster".
- The pauses that keep the model under its rate limit are cut.
- Some typing and page changes play faster.

Where the narration needs more time than the recording gives it, the screen holds still instead.

The rendered video is not in git. This folder makes it again.

## How it is made

1. **Recording.** `record.mjs` drives the app in a phone-sized headless Chrome (390×844 at 2.5×) through the ten scenes. It saves each scene as timestamped screenshots in `work/raw/<scene>/`. Each scene's `scene.json` also notes the stretches spent waiting for the model and the rate-limit pauses.
2. **Narration.** `scenes.py` holds the lines, each timed to a moment in the recording. `voice.py` speaks them with Microsoft's neural voice Yunyang (`zh-CN-YunyangNeural`) through [edge-tts](https://github.com/rany2/edge-tts), one WAV per line, in `work/voice/`.
   - **What edge-tts is.** It uses the speech service behind Edge's Read Aloud, which isn't an official API. That works without an account, but the lines' words go to Microsoft, and the service could change or stop.
   - **If it stops working.** The same voices are offered officially by Azure Speech, which needs a key.
3. **Edit.** `build_edit.py` turns each scene into a clip at its real timing, apart from the speed-ups above.
   - **Narration timing.** Each line starts at its moment. Where a line needs longer than its stretch of recording, the screen holds at that stretch's stillest moment (a still screen saves as frames of the same size) until the line is said.
   - **Sound.** It mixes the lines over a music bed. The bed sits 15 dB under the voice, and dips further whenever the voice speaks. The sound track aims at −16 LUFS, with peaks kept under −1 dB. The build prints what it measured: −17.0 LUFS for the delivered video.
   - **Composition.** It writes the [Hyperframes](https://github.com/heygen-com/hyperframes) composition `work/project/index.html` from `template.html`. Captions, the ladder and the zooms are placed by recorded time, so they stay on their moments whatever the timing.
4. **Render.** Hyperframes renders the composition, sound included, to `work/out/demo.mp4`.

| File | What it does |
|---|---|
| `video.sh` | Every step, with `./video.sh` alone listing them |
| `record.mjs` | The scenes: what is typed, tapped and scrolled |
| `scenes.py` | What the video says: each scene's trim, speed-ups, captions, narration, ladder rung and zooms, in seconds into the recording; the voice and its pace |
| `voice.py` | Speaks the narration's new or changed lines |
| `music.py` | The music bed, generated from sine waves (soft chords, a light arpeggio and a bass in C major at 84 bpm), so there are no rights to clear |
| `build_edit.py` | The clips, the sound and the composition |
| `template.html` | The page: layout, intro and closing card (including the evaluation figures, test count and team), animation |
| `check_frames.py` | Frames of the render just after each caption appears and mid-zoom, as sheets for review |
| `grid.py` | One frame a second of a recorded scene, as a sheet, for reading off times |

Everything the page loads is local. GSAP comes from npm, and the app's MiSans font and logo come from `frontend/`. Nothing loads from a CDN. Hyperframes runs with its telemetry, update checks and self-installs turned off.

## Making it again

You need:
- **Node 22 or later.** If nvm is installed, `video.sh` switches to 22 itself.
- **The backend's Python environment** (`cd backend && uv sync`), whose Pillow the review sheets use.
- **The frontend's packages** (`cd frontend && npm ci`), for the font.
- **Chrome or Chromium.** From WSL, the Windows Chrome works.
- **FFmpeg.** `./video.sh ffmpeg` gets FFmpeg, and the libraries headless Chrome needs, from Ubuntu 24.04's own packages. It unpacks them into `work/` without sudo.
- **For the narration, uv and a network connection.** `./video.sh install` uses uv, as the backend does, to put edge-tts in `work/edge`. To use another voice or pace, change `VOICE` in `scenes.py`; `edge-tts --list-voices` lists them.

**Start the app with the model on**, on a fresh data folder, as the video was recorded:

```bash
cd backend && DATA_DIR=/tmp/ba-video LLM_ENABLED=true PUBLIC_BASE_URL=http://localhost:8000 PASSKEY_RP_ID=localhost uv run uvicorn app.main:app --port 8000
```

The model's settings come from `.env` as usual (see `.env.example`). Recording calls the model up to nine times, once for each message the scenes send, so it is a paid run (AGENTS.md, rule 5). The recorder keeps the calls 13.5 seconds apart for the key's limit of five a minute, and the edit cuts those pauses.

Recording works with the offline planner too (`LLM_ENABLED=false`, no model calls), and that is how the current recorder was tested. It isn't good enough for the video: the cards then say 由内置规则拟定（未启用 AI 模型）, and in the coffee scene the analysis code is the model's.

Then:

```bash
cd submission/video
./video.sh install    # once: Playwright, Hyperframes, GSAP, Hyperframes' headless Chrome, edge-tts
./video.sh chrome     # headless Chrome with a DevTools port (CDP=http://localhost:9335)
./video.sh record     # several minutes; BASE=http://localhost:8000
./video.sh voice      # speaks the lines that are new or changed
./video.sh build      # the clips, the sound and the composition
./video.sh render     # about 8 minutes
./video.sh check      # review sheets in work/check
```

**Other build options.** `./video.sh build --silent` builds the edit without narration or music. `./video.sh preview` opens the Hyperframes studio on port 3002 to scrub through the edit. `./video.sh build --no-clips` rewrites the page and the sound without encoding the clips again. Use it only when no line's length changed, since a longer or shorter line moves the holds.

### After a new recording

**Times carry over between takes.** The times in `scenes.py` were read off the take the delivered video uses. `build_edit.py` carries them over to a new take by keeping each moment's distance from the nearest model wait, which holds while the app behaves as it did.

**After a UI change, check the times by eye.** Run `./video.sh grids` and look at the sheets in `work/grids` before adjusting `scenes.py`.

**The chat now scrolls a new reply into view itself.** When the reply is taller than the screen, its first line goes under the title bar. The delivered take was recorded before that change, so in scene 03 the name-mismatch box will probably sit lower, and the first zoom's point will likely need moving.

**Scenes build on each other.** For example, 04 needs the transfer from 03, and every scene needs the demo bank that 01 opens. Re-record from `landing`, naming the scenes you want: `./video.sh record landing red returned`.

**The closing card's figures are typed into `template.html`, and the narration repeats some of them.** They are the evaluation results, the 23 October footnote and the test count. The narration's closing line (`OUTRO_VOICE` in `scenes.py`) repeats the evaluation results, so update both when they change.
