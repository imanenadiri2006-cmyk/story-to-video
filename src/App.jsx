import React, { useState, useEffect, useRef, useCallback } from "react";
import { Play, Pause, ChevronLeft, ChevronRight, Upload, Volume2, VolumeX, RotateCcw, BookOpen, Wand2, AlertCircle } from "lucide-react";

const FONTS = `
  @import url('https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,600;0,9..144,700;1,9..144,600&family=Literata:ital,wght@0,400;0,500;1,400&family=Nunito:wght@600;700;800&display=swap');
`;

const PALETTE = {
  night: "#241F30",
  night2: "#332B44",
  parchment: "#F7EFE0",
  parchment2: "#EFE3CC",
  rose: "#D98A93",
  sage: "#8CA888",
  gold: "#E7B764",
  ink: "#372E3B",
};

// ---- Helpers -----------------------------------------------------------
function stripToSvg(text) {
  if (!text) return null;
  let t = text.trim();
  t = t.replace(/```svg/gi, "").replace(/```/g, "").trim();
  const start = t.indexOf("<svg");
  const end = t.lastIndexOf("</svg>");
  if (start === -1 || end === -1) return null;
  return t.slice(start, end + 6);
}

function stripToJson(text) {
  if (!text) return null;
  let t = text.trim();
  t = t.replace(/```json/gi, "").replace(/```/g, "").trim();
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start === -1 || end === -1) return null;
  try {
    return JSON.parse(t.slice(start, end + 1));
  } catch {
    return null;
  }
}

function placeholderSvg(seed = 0) {
  const hues = [
    ["#EAD9C4", "#D8A9A0", "#B98C86"],
    ["#DCE8D8", "#A9C2A0", "#7E9E7C"],
    ["#E3DCEF", "#B7A6D6", "#8C79B0"],
    ["#F3E4C6", "#E3B77E", "#C68F52"],
  ];
  const c = hues[seed % hues.length];
  return `<svg viewBox="0 0 800 500" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <radialGradient id="g${seed}" cx="50%" cy="45%" r="75%">
        <stop offset="0%" stop-color="${c[0]}"/>
        <stop offset="60%" stop-color="${c[1]}"/>
        <stop offset="100%" stop-color="${c[2]}"/>
      </radialGradient>
      <filter id="b${seed}"><feGaussianBlur stdDeviation="18"/></filter>
    </defs>
    <rect width="800" height="500" fill="url(#g${seed})"/>
    <ellipse cx="220" cy="380" rx="180" ry="70" fill="${c[2]}" opacity="0.35" filter="url(#b${seed})"/>
    <ellipse cx="600" cy="120" rx="150" ry="90" fill="#ffffff" opacity="0.25" filter="url(#b${seed})"/>
  </svg>`;
}

async function callClaude({ system, prompt }) {
  const response = await fetch("/api/claude", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ system, prompt }),
  });
  if (!response.ok) throw new Error("Erreur API (" + response.status + ")");
  const data = await response.json();
  return data.text || "";
}

// ---- Main component -----------------------------------------------------
export default function StoryToVideo() {
  const [screen, setScreen] = useState("input"); // input | loading | player | error
  const [story, setStory] = useState("");
  const [title, setTitle] = useState("");
  const [scenes, setScenes] = useState([]);
  const [current, setCurrent] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [loadingLabel, setLoadingLabel] = useState("");
  const [loadingProgress, setLoadingProgress] = useState(0);
  const [errorMsg, setErrorMsg] = useState("");
  const [validation, setValidation] = useState("");
  const fileInputRef = useRef(null);
  const utteranceRef = useRef(null);
  const advanceTimerRef = useRef(null);
  const voicesRef = useRef([]);

  useEffect(() => {
    function loadVoices() {
      voicesRef.current = window.speechSynthesis
        ? window.speechSynthesis.getVoices()
        : [];
    }
    loadVoices();
    if (window.speechSynthesis) {
      window.speechSynthesis.onvoiceschanged = loadVoices;
    }
    return () => {
      if (window.speechSynthesis) window.speechSynthesis.cancel();
      clearTimeout(advanceTimerRef.current);
    };
  }, []);

  const handleFileUpload = (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => setStory(String(ev.target.result || ""));
    reader.readAsText(file, "utf-8");
  };

  const generateVideo = async () => {
    if (story.trim().length < 30) {
      setValidation(
        "Colle ou importe une histoire un peu plus longue (au moins quelques phrases)."
      );
      return;
    }
    setValidation("");
    setScreen("loading");
    setLoadingProgress(0);
    setLoadingLabel("Découpage de l'histoire en scènes...");

    try {
      const splitText = await callClaude({
        system:
          "Tu decoupes une histoire en scenes pour une video animee de type conte illustre a l'aquarelle. Reponds UNIQUEMENT avec un JSON valide, sans texte avant ni apres, sans balises markdown.",
        prompt: `Decoupe cette histoire en 5 a 8 scenes courtes. Pour chaque scene fournis: - "narration": le texte a lire a voix haute, en francais, 1 a 3 phrases fluides, adapte a une lecture audio - "visual": une description visuelle precise (personnages, decor, ambiance, couleurs) en francais, pour un illustrateur Reponds uniquement avec un JSON de cette forme exacte: {"title": "titre court de l'histoire", "scenes": [{"narration": "...", "visual": "..."}]} Histoire: ${story}`,
      });
      const parsed = stripToJson(splitText);
      if (!parsed || !Array.isArray(parsed.scenes) || parsed.scenes.length === 0) {
        throw new Error("Impossible de découper l'histoire en scènes.");
      }
      const sceneList = parsed.scenes.slice(0, 8).map((s) => ({
        narration: s.narration || "",
        visual: s.visual || "",
        svg: null,
      }));
      setTitle(parsed.title || "Mon histoire");
      setScenes(sceneList);

      for (let i = 0; i < sceneList.length; i++) {
        setLoadingLabel(
          `Peinture de l'illustration ${i + 1} sur ${sceneList.length}...`
        );
        setLoadingProgress(Math.round((i / sceneList.length) * 100));
        try {
          const svgText = await callClaude({
            system:
              "Tu es un illustrateur qui cree des illustrations SVG dans un style aquarelle douce pour livre de conte pour enfants. Reponds UNIQUEMENT avec le code SVG brut, commencant par <svg et finissant par </svg>, sans texte, sans markdown. Le SVG doit avoir viewBox='0 0 800 500'. Utilise des degrades (linearGradient / radialGradient) et des filtres de flou (feGaussianBlur) pour simuler un rendu aquarelle, des formes organiques, une palette douce et chaleureuse. Pas de texte dans le SVG.",
            prompt: `Illustration pour cette scene: ${sceneList[i].visual}`,
          });
          const svg = stripToSvg(svgText) || placeholderSvg(i);
          sceneList[i].svg = svg;
        } catch {
          sceneList[i].svg = placeholderSvg(i);
        }
        setScenes([...sceneList]);
      }
      setLoadingProgress(100);
      setCurrent(0);
      setScreen("player");
      setIsPlaying(true);
    } catch (err) {
      setErrorMsg(err.message || "Une erreur est survenue.");
      setScreen("error");
    }
  };

  const speakScene = useCallback(
    (index, sceneList) => {
      const list = sceneList || scenes;
      const text = list[index] && list[index].narration;
      if (!window.speechSynthesis || !text) return;
      window.speechSynthesis.cancel();
      const utter = new SpeechSynthesisUtterance(text);
      const voices = voicesRef.current;
      const frVoice = voices.find(
        (v) => v.lang && v.lang.toLowerCase().startsWith("fr")
      );
      if (frVoice) utter.voice = frVoice;
      utter.lang = "fr-FR";
      utter.rate = 0.96;
      utter.pitch = 1.02;
      utter.onend = () => {
        advanceTimerRef.current = setTimeout(() => {
          goNextAuto(index);
        }, 500);
      };
      utteranceRef.current = utter;
      window.speechSynthesis.speak(utter);
    },
    [scenes]
  );

  const estimateSilentDuration = (text) => {
    const words = (text || "").split(/\s+/).filter(Boolean).length;
    return Math.max(1800, words * 380);
  };

  const goNextAuto = (fromIndex) => {
    setCurrent((prevCurrent) => {
      const idx = fromIndex !== undefined ? fromIndex : prevCurrent;
      if (idx >= scenes.length - 1) {
        setIsPlaying(false);
        return idx;
      }
      return idx + 1;
    });
  };

  // Drive narration / silent auto-advance whenever the current scene or play state changes
  useEffect(() => {
    clearTimeout(advanceTimerRef.current);
    if (window.speechSynthesis) window.speechSynthesis.cancel();
    if (screen !== "player" || !isPlaying || scenes.length === 0) return;

    if (muted) {
      const text = scenes[current] && scenes[current].narration;
      advanceTimerRef.current = setTimeout(() => {
        goNextAuto(current);
      }, estimateSilentDuration(text));
    } else {
      speakScene(current, scenes);
    }

    return () => {
      clearTimeout(advanceTimerRef.current);
      if (window.speechSynthesis) window.speechSynthesis.cancel();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current, isPlaying, muted, screen]);

  const togglePlay = () => setIsPlaying((p) => !p);
  const goTo = (i) => {
    setCurrent(i);
    setIsPlaying(true);
  };
  const goNext = () => {
    if (current < scenes.length - 1) goTo(current + 1);
  };
  const goPrev = () => {
    if (current > 0) goTo(current - 1);
  };
  const restart = () => {
    setCurrent(0);
    setIsPlaying(true);
  };
  const newStory = () => {
    if (window.speechSynthesis) window.speechSynthesis.cancel();
    clearTimeout(advanceTimerRef.current);
    setScreen("input");
    setScenes([]);
    setIsPlaying(false);
  };

  // ---- Render -------------------------------------------------------
  const pageFrame = {
    borderRadius: "14px 46px 18px 50px",
  };

  return (
    <div
      style={{
        minHeight: "100%",
        width: "100%",
        background: `radial-gradient(1200px 600px at 20% -10%, ${PALETTE.night2}, ${PALETTE.night} 60%)`,
        fontFamily: "'Nunito', sans-serif",
        color: PALETTE.parchment,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "32px 16px",
        boxSizing: "border-box",
      }}
    >
      <style>{FONTS}</style>
      {screen === "input" && (
        <div className="w-full max-w-xl">
          <div className="flex items-center gap-2 mb-6 justify-center">
            <BookOpen size={22} color={PALETTE.gold} />
            <span
              style={{
                fontFamily: "'Nunito',sans-serif",
                fontWeight: 800,
                letterSpacing: 1,
                fontSize: 13,
                textTransform: "uppercase",
                color: PALETTE.gold,
              }}
            >
              Histoire en vidéo
            </span>
          </div>
          <h1
            style={{
              fontFamily: "'Fraunces', serif",
              fontWeight: 700,
              fontStyle: "italic",
              fontSize: "clamp(28px, 5vw, 40px)",
              textAlign: "center",
              marginBottom: 10,
              lineHeight: 1.15,
            }}
          >
            Transforme ton histoire en conte animé
          </h1>
          <p
            style={{
              textAlign: "center",
              color: PALETTE.parchment2,
              opacity: 0.8,
              marginBottom: 28,
              fontSize: 15,
            }}
          >
            Colle ou importe un texte : il devient un livre animé à l'aquarelle,
            avec une narration lue à voix haute.
          </p>
          <div
            style={{
              background: PALETTE.parchment,
              color: PALETTE.ink,
              ...pageFrame,
              padding: 22,
              boxShadow: "0 20px 60px rgba(0,0,0,0.35)",
            }}
          >
            <textarea
              value={story}
              onChange={(e) => setStory(e.target.value)}
              placeholder="Il était une fois..."
              rows={9}
              style={{
                width: "100%",
                resize: "vertical",
                border: `1.5px solid ${PALETTE.parchment2}`,
                borderRadius: 12,
                padding: 14,
                fontFamily: "'Literata', serif",
                fontSize: 15,
                lineHeight: 1.5,
                outline: "none",
                background: "#FFFDF8",
                boxSizing: "border-box",
              }}
            />
            <div className="flex items-center justify-between mt-3 flex-wrap gap-2">
              <button
                onClick={() =>
                  fileInputRef.current && fileInputRef.current.click()
                }
                className="flex items-center gap-2"
                style={{
                  background: "transparent",
                  border: `1.5px solid ${PALETTE.ink}`,
                  color: PALETTE.ink,
                  borderRadius: 999,
                  padding: "8px 14px",
                  fontWeight: 700,
                  fontSize: 13,
                  cursor: "pointer",
                }}
              >
                <Upload size={15} />
                Importer un fichier .txt
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".txt,text/plain"
                onChange={handleFileUpload}
                style={{ display: "none" }}
              />
              <span style={{ fontSize: 12, opacity: 0.55 }}>
                {story.trim().length} caractères
              </span>
            </div>
            {validation && (
              <div className="flex items-center gap-2 mt-3" style={{ color: "#9B4B45", fontSize: 13 }}>
                <AlertCircle size={15} />
                {validation}
              </div>
            )}
            <button
              onClick={generateVideo}
              className="flex items-center justify-center gap-2 mt-4"
              style={{
                width: "100%",
                background: PALETTE.gold,
                color: PALETTE.ink,
                border: "none",
                borderRadius: 999,
                padding: "13px 18px",
                fontWeight: 800,
                fontSize: 15,
                cursor: "pointer",
                boxShadow: "0 8px 22px rgba(231,183,100,0.4)",
              }}
            >
              <Wand2 size={17} />
              Créer la vidéo
            </button>
          </div>
        </div>
      )}
      {screen === "loading" && (
        <div className="w-full max-w-md text-center">
          <div
            style={{
              width: 64,
              height: 64,
              margin: "0 auto 22px",
              borderRadius: "50%",
              border: `3px solid ${PALETTE.parchment2}33`,
              borderTopColor: PALETTE.gold,
              animation: "spin 1s linear infinite",
            }}
          />
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
          <p
            style={{
              fontFamily: "'Fraunces', serif",
              fontStyle: "italic",
              fontSize: 20,
              marginBottom: 14,
            }}
          >
            {loadingLabel}
          </p>
          <div
            style={{
              height: 8,
              borderRadius: 999,
              background: `${PALETTE.parchment2}33`,
              overflow: "hidden",
            }}
          >
            <div
              style={{
                height: "100%",
                width: `${loadingProgress}%`,
                background: PALETTE.gold,
                transition: "width 0.4s ease",
              }}
            />
          </div>
        </div>
      )}
      {screen === "error" && (
        <div className="w-full max-w-md text-center">
          <AlertCircle size={32} color={PALETTE.rose} style={{ margin: "0 auto 14px" }} />
          <p style={{ fontFamily: "'Fraunces', serif", fontSize: 20, marginBottom: 8 }}>
            Un imprévu dans l'histoire
          </p>
          <p
            style={{
              color: PALETTE.parchment2,
              opacity: 0.8,
              marginBottom: 20,
              fontSize: 14,
            }}
          >
            {errorMsg}
          </p>
          <button
            onClick={() => setScreen("input")}
            style={{
              background: PALETTE.gold,
              color: PALETTE.ink,
              border: "none",
              borderRadius: 999,
              padding: "10px 20px",
              fontWeight: 800,
              cursor: "pointer",
            }}
          >
            Réessayer
          </button>
        </div>
      )}
      {screen === "player" && scenes.length > 0 && (
        <div className="w-full max-w-2xl">
          <div className="flex items-center justify-between mb-4">
            <span
              style={{
                fontFamily: "'Fraunces', serif",
                fontStyle: "italic",
                fontSize: 18,
                color: PALETTE.gold,
              }}
            >
              {title}
            </span>
            <button
              onClick={newStory}
              className="flex items-center gap-1"
              style={{
                background: "transparent",
                border: "none",
                color: PALETTE.parchment2,
                opacity: 0.75,
                fontSize: 12,
                cursor: "pointer",
              }}
            >
              Nouvelle histoire
            </button>
          </div>
          <div
            style={{
              background: PALETTE.parchment,
              ...pageFrame,
              padding: 16,
              boxShadow: "0 25px 70px rgba(0,0,0,0.4)",
            }}
          >
            <div
              key={current}
              style={{
                borderRadius: "8px 30px 10px 34px",
                overflow: "hidden",
                aspectRatio: "8 / 5",
                background: "#EFE3CC",
                animation: "fadein 0.5s ease",
              }}
              dangerouslySetInnerHTML={{
                __html: scenes[current].svg || placeholderSvg(current),
              }}
            />
            <style>{`@keyframes fadein { from { opacity: 0; transform: scale(0.985);} to { opacity:1; transform: scale(1);} }`}</style>
            <p
              style={{
                fontFamily: "'Literata', serif",
                fontStyle: "italic",
                color: PALETTE.ink,
                fontSize: 17,
                lineHeight: 1.55,
                textAlign: "center",
                padding: "18px 10px 6px",
                minHeight: 60,
              }}
            >
              {scenes[current].narration}
            </p>
            <div className="flex items-center justify-center gap-1 flex-wrap mb-3">
              {scenes.map((_, i) => (
                <button
                  key={i}
                  onClick={() => goTo(i)}
                  title={`Page ${i + 1}`}
                  style={{
                    width: 26,
                    height: 26,
                    borderRadius: "50%",
                    border: `1.5px solid ${PALETTE.ink}`,
                    background: i === current ? PALETTE.gold : "transparent",
                    color: PALETTE.ink,
                    fontFamily: "'Fraunces', serif",
                    fontWeight: 700,
                    fontSize: 11,
                    cursor: "pointer",
                    margin: 2,
                  }}
                >
                  {i + 1}
                </button>
              ))}
            </div>
            <div className="flex items-center justify-center gap-3">
              <button
                onClick={goPrev}
                disabled={current === 0}
                style={iconBtnStyle(current === 0)}
              >
                <ChevronLeft size={18} />
              </button>
              <button
                onClick={togglePlay}
                style={{ ...iconBtnStyle(false), width: 52, height: 52, background: PALETTE.gold }}
              >
                {isPlaying ? <Pause size={20} /> : <Play size={20} />}
              </button>
              <button
                onClick={goNext}
                disabled={current === scenes.length - 1}
                style={iconBtnStyle(current === scenes.length - 1)}
              >
                <ChevronRight size={18} />
              </button>
              <button onClick={() => setMuted((m) => !m)} style={iconBtnStyle(false)}>
                {muted ? <VolumeX size={17} /> : <Volume2 size={17} />}
              </button>
              <button onClick={restart} style={iconBtnStyle(false)}>
                <RotateCcw size={16} />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function iconBtnStyle(disabled) {
  return {
    width: 42,
    height: 42,
    borderRadius: "50%",
    border: `1.5px solid ${PALETTE.ink}`,
    background: "transparent",
    color: PALETTE.ink,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    cursor: disabled ? "default" : "pointer",
    opacity: disabled ? 0.35 : 1,
  };
}
