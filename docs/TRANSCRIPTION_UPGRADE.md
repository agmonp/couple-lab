# שדרוג מנוע התמלול

## 2026-10-26: עברית מדויקת באפליקציה הארוזה (0.3.0)

- מנוע: whisper.cpp (`whisper-server`, Vulkan + גרסאות CPU שנטענות בזמן ריצה) ארוז ב־exe תחת `resources/whisper-engine`.
- מודל: `ivrit-ai/whisper-large-v3-turbo-ggml` בכיווץ q5_0 (574,041,195 בתים, SHA-256 `6c1da92e…a572`), יורד מתוך האפליקציה לתיקיית המשתמש (`userData/models/asr`), עם המשך אחרי ניתוק ובדיקת SHA-256. לא לתיקיית האפליקציה: ה־exe הנייד נפתח לתיקייה זמנית חדשה בכל הפעלה.
- `electron/whispercpp-engine.cjs` מחזיר חלונות באותה צורה כמו `whisper-engine.py`, כך שה־VAD, החלונות והסינון משותפים. whisper.cpp מחלק מילה בין שני סגמנטים לפעמים ("גר" | "מניה"); `joinSplitWords` מחבר.
- אם Vulkan נכשל בהפעלה, מנסים שוב עם `--no-gpu`. אם המנוע נכשל באמצע, חוזרים ל־sherpa והסיבה נשמרת.
- מדידה (20 משפטי FLEURS, `scripts/bench-hebrew-asr.cjs`): tiny 88.8% · CPU 25.8% (1.36 ש׳ לשנייה) · Vulkan 25.5% (0.07) · faster-whisper CUDA 26.1% (0.04). כלומר q5 ו־whisper.cpp לא מאבדים דיוק.
- נבנה ב־`.github/workflows/build-asr-engine.yml` ופורסם ב־release `asr-engine-v1` (pre-release, כדי ש־latest יישאר האפליקציה).

## 2026-10-15: מנוע GPU עברי (לקחים מפרויקט "שמע")

כש־`.venv-asr` קיים בתיקיית הפרויקט, ה־worker מעביר כל הקלטה ל־`electron/whisper-engine.py`
(faster-whisper + `ivrit-ai/whisper-large-v3-turbo-ct2`, CUDA float16, CPU int8 כגיבוי). אם המנוע
לא עולה — sherpa-onnx כמו קודם, והסיבה נשמרת ב־`metadata.engineFallbackReason` ובאבחון
(`transcription.engine_fallback`). הכול מקומי; המודל נטען עם `local_files_only`.

התקנה: `powershell -ExecutionPolicy Bypass -File .\scripts\install-hebrew-asr.ps1`. ביטול: למחוק `.venv-asr`.
כיבוי זמני: `COUPLE_LAB_ASR_ENGINE=off`.

מה הועתק מ"שמע" (`docs/ASR_2.md` שם):
- פענוח: beam 5, חותמות זמן למילים, עברית כפויה, `condition_on_previous_text=False`, **בלי** שמות ב־initial_prompt (שמות ברמז גרמו ל־Whisper להמציא אותם על שקט).
- חלונות `overlap+vadnorm`: ריפוד 0.5ש׳, איחוד פערים <0.8ש׳ עד 28ש׳, פיצול ל־20ש׳ עם חפיפה 2ש׳, כל מילה שייכת לחלון אחד (לפי אמצע המילה).
- ה־VAD שומע עותק מנורמל (שיא 0.5, עד 30dB); Whisper מקבל את המקור.
- סינון: no_speech ≥0.6, avg_logprob ≤−1.2, וההזיות הידועות ("תודה רבה", "כתוביות"…) נזרקים — גם במסלול sherpa.
- וקטורי דובר (CAM++) ב־thread אחד: אותם וקטורים, פחות CPU.

חדש כאן, מעבר ל"שמע": מעבר VAD שני על כל קטע שקט ≥1ש׳, מנורמל לשיא שלו (עד 40dB) — בן/בת זוג
שקט/ה ליד קול חזק לא נעלם. משפטי FLEURS שהיו 37–43dB מתחת לשכנים לא פוענחו בכלל בלי זה.

**מדידה** (FLEURS עברית, 5 הקלטות × 4 משפטים ≈40ש׳, ה־worker האמיתי; 2026-10-15, RTX 5070 Ti):

| | רמה רגילה (−31dBFS) | שקט (−50dBFS) | רעש/שקט 20ש׳ ×5 | זמן/שנייה |
|---|---|---|---|---|
| לפני (whisper-tiny) | WER 87.8% | 90.5% | 0 מילים | 0.04 |
| tiny + הסינון וה־VAD החדשים | 86.9% | 89.6% | 0 | 0.04 |
| **ivrit turbo GPU** | **15.9%** | **20.5%** | **0** | 0.03 |

זה דיבור מוקרא, לא שיחה זוגית — כיוון, לא הבטחה. הכיול באשף (WER על משפטי הקריאה) מודד אוטומטית את המנוע החדש.
מגבלה: ב־build ארוז (portable exe) המנוע לא זמין — רק בהרצה מהתיקייה (הקיצור בשולחן העבודה).

## drop-in של חבילות sherpa-onnx (2026-08-14)

Electron סורק בהפעלה את `models/asr/` ובוחר אוטומטית את חבילת המודל הטובה ביותר:
כל תיקייה שמכילה `*encoder*.onnx`, `*decoder*.onnx` ו־`*tokens*.txt` היא חבילה תקינה,
וכל חבילה שאינה `whisper-tiny` מקבלת עדיפות. כלומר — כדי לשדרג את איכות
התמלול בעברית מספיק להניח תיקייה חדשה ולהפעיל מחדש.

## למה לשדרג

whisper-tiny int8 הוא רצפת האיכות של כל מנוע הניתוח. הפיין־טיון העברי של
ivrit.ai (Apache-2.0, ~5,050 שעות עברית) מדויק ממנו דרמטית. התמלול רץ אחרי
עצירת ההקלטה, לא בזמן אמת — לכן זמן פענוח ארוך יותר כמעט אינו מורגש.

## שלבים

1. להוריד או לייצא את המודל בפורמט sherpa-onnx (encoder/decoder ONNX + tokens):
   - מוכן מראש: חיפוש "ivrit whisper onnx" ב־Hugging Face (למשל
     `instush/ivrit-whisper-large-v3-turbo-timestamped-onnx`), או
   - ייצוא עצמי עם הסקריפט הרשמי:
     `https://k2-fsa.github.io/sherpa/onnx/pretrained_models/whisper/export-onnx.html`
     על `ivrit-ai/whisper-large-v3-turbo`.
2. ליצור תיקייה חדשה, למשל: `models/asr/ivrit-whisper-large-v3-turbo/`
   ולהניח בה את שלושת הקבצים. להוסיף `SOURCE.md` עם המקור וה־SHA-256.
3. להפעיל מחדש את Couple Lab. מסך האבחון יציג את ה־modelId החדש.
4. לאמת: להריץ שוב את כיול הקול (קריאת המשפטים) — תוצאת ה־WER של המודל
   החדש נשמרת אוטומטית ב־`couple-lab-transcription-calibration` ומושווית
   לישנה. אם ה־WER לא השתפר, פשוט למחוק את התיקייה.

## הערות

- גודל: חבילת large-v3-turbo היא ~1.5GB מול ~103MB של tiny. אם אורזים
  portable build, לשקול להשאיר את tiny כברירת מחדל בחבילה ולהניח את המודל
  הגדול רק בהתקנה המקומית (extraResources כבר מעתיק את כל `models/`).
- אין צורך בשינוי קוד או קונפיגורציה — הבחירה אוטומטית לפי תוכן התיקייה.
- ה־VAD (silero) נשאר זהה ואינו תלוי במודל התמלול.
