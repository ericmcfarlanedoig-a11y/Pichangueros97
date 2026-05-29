import { useState, useEffect, useCallback } from "react";
import { supabase } from "./supabase";

const RED   = "#c0392b";
const GREEN = "#27ae60";
const GOLD  = "#f39c12";

const HISTORICAL_SCORERS = {
  Chicho:29, Cuchi:21, Eric:19, JE:9, Jesus:9, Giancarlo:9,
  Champi:6, Barreto:5, Álvaro:5, Roberto:4, Pablo:4,
  Barrigol:4, Beto:3, "Diego M":3, Pancho:2, Manolo:2,
  Aldo:1, Salvador:1, Cali:1
};

function computeStats(matches) {
  let rw=0, gw=0, draws=0, rg=0, gg=0;
  matches.forEach(m => {
    rg += m.rojos; gg += m.verdes;
    if (m.result === "Rojos") rw++;
    else if (m.result === "Verdes") gw++;
    else draws++;
  });
  return { rw, gw, draws, rg, gg, total: matches.length };
}

function computeScorers(matches) {
  const totals = { ...HISTORICAL_SCORERS };
  matches.forEach(m => {
    (m.scorers || []).forEach(({ name, goals }) => {
      totals[name] = (totals[name] || 0) + goals;
    });
  });
  return Object.entries(totals)
    .map(([name, goals]) => ({ name, goals }))
    .sort((a,b) => b.goals - a.goals);
}

export default function App() {
  const [tab, setTab] = useState("dashboard");
  const [matches, setMatches] = useState([]);
  const [players, setPlayers] = useState([]);
  const [convocados, setConvocados] = useState([]);
  const [loading, setLoading] = useState(true);

  // New match form
  const [matchDate, setMatchDate] = useState("");
  const [rojosScore, setRojosScore] = useState(0);
  const [verdesScore, setVerdesScore] = useState(0);
  const [scorers, setScorers] = useState([]);
  const [saving, setSaving] = useState(false);

  // AI importer
  const [aiText, setAiText] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiResult, setAiResult] = useState(null);
  const [newPlayer, setNewPlayer] = useState("");

  const loadData = useCallback(async () => {
    setLoading(true);
    const [{ data: matchRows }, { data: scorerRows }, { data: playerRows }, { data: convRows }] = await Promise.all([
      supabase.from("matches").select("*").order("id"),
      supabase.from("scorers").select("*"),
      supabase.from("players").select("*").order("name"),
      supabase.from("convocados").select("*"),
    ]);
    const matchesWithScorers = (matchRows || []).map(m => ({
      ...m,
      scorers: (scorerRows || []).filter(s => s.match_id === m.id)
    }));
    setMatches(matchesWithScorers);
    setPlayers((playerRows || []).map(p => p.name));
    setConvocados((convRows || []).map(c => c.name));
    setLoading(false);
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  // Real-time subscriptions
  useEffect(() => {
    const channel = supabase.channel("realtime-all")
      .on("postgres_changes", { event: "*", schema: "public" }, () => loadData())
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [loadData]);

  const toggleConv = async (name) => {
    if (convocados.includes(name)) {
      await supabase.from("convocados").delete().eq("name", name);
    } else {
      await supabase.from("convocados").insert({ name, week: new Date().toISOString().slice(0,10) });
    }
    loadData();
  };

  const clearConvocados = async () => {
    await supabase.from("convocados").delete().neq("name", "___");
    loadData();
  };

  const addPlayer = async () => {
    const t = newPlayer.trim();
    if (!t) return;
    await supabase.from("players").insert({ name: t });
    setNewPlayer("");
    loadData();
  };

  const addScorer = (name) => {
    if (!name) return;
    if (scorers.find(s => s.name === name)) {
      setScorers(scorers.map(s => s.name === name ? {...s, goals: s.goals+1} : s));
    } else {
      setScorers([...scorers, { name, team: "rojos", goals: 1 }]);
    }
  };
  const removeScorer = (name) => setScorers(scorers.filter(s => s.name !== name));
  const updateScorerTeam = (name, team) => setScorers(scorers.map(s => s.name === name ? {...s, team} : s));
  const updateScorerGoals = (name, goals) => setScorers(scorers.map(s => s.name === name ? {...s, goals: Math.max(1, Number(goals))} : s));

  const saveMatch = async () => {
    if (!matchDate.trim()) return alert("Ingresa el nombre del partido");
    setSaving(true);
    const r = Number(rojosScore), g = Number(verdesScore);
    const result = r > g ? "Rojos" : g > r ? "Verdes" : "Empate";
    const { data: newMatch } = await supabase
      .from("matches")
      .insert({ date: matchDate, rojos: r, verdes: g, result })
      .select().single();
    if (newMatch && scorers.length > 0) {
      await supabase.from("scorers").insert(
        scorers.map(s => ({ match_id: newMatch.id, name: s.name, team: s.team, goals: s.goals }))
      );
    }
    await clearConvocados();
    setMatchDate(""); setRojosScore(0); setVerdesScore(0); setScorers([]);
    setSaving(false);
    setTab("dashboard");
    loadData();
  };

  const runAI = async () => {
    if (!aiText.trim()) return;
    setAiLoading(true); setAiResult(null);
    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 1000,
          messages: [{
            role: "user",
            content: `Del siguiente texto de WhatsApp, extrae los nombres de personas que confirmaron asistencia a un partido de fútbol. Ignora emojis, mensajes de "no puedo", "no voy", etc. Solo incluye los que claramente CONFIRMAN que van. Devuelve SOLO un JSON válido con esta estructura: {"names": ["nombre1","nombre2",...]}. Sin markdown, sin explicación.\n\nTexto:\n${aiText}`
          }]
        })
      });
      const data = await res.json();
      const text = data.content?.find(b => b.type === "text")?.text || "";
      const parsed = JSON.parse(text.replace(/```json|```/g, "").trim());
      setAiResult(parsed.names || []);
    } catch(e) {
      alert("Error al procesar. Agrega los nombres manualmente.");
    }
    setAiLoading(false);
  };

  const confirmAI = async () => {
    if (!aiResult) return;
    const nuevos = aiResult.filter(n => !convocados.includes(n));
    if (nuevos.length > 0) {
      await supabase.from("convocados").insert(
        nuevos.map(name => ({ name, week: new Date().toISOString().slice(0,10) }))
      );
    }
    setAiText(""); setAiResult(null);
    loadData();
  };

  const stats = computeStats(matches);
  const scorersList = computeScorers(matches.filter(m => m.id >= 18));
  const recentMatches = [...matches].reverse().slice(0, 8);

  const s = {
    app: { fontFamily: "'Barlow', sans-serif", maxWidth: 860, margin: "0 auto", padding: "0 0 60px", background: "#f7f7f5", minHeight: "100vh" },
    header: { background: "#1a1a1a", padding: "20px 24px 0", marginBottom: 0 },
    logo: { color: "#fff", fontSize: 24, fontWeight: 800, letterSpacing: "-0.5px", margin: 0 },
    sub: { color: "#888", fontSize: 13, margin: "2px 0 16px" },
    tabs: { display: "flex", gap: 4 },
    tab: (active) => ({
      padding: "10px 18px", fontSize: 14, fontWeight: 600, cursor: "pointer",
      border: "none", background: active ? "#f7f7f5" : "transparent",
      color: active ? "#1a1a1a" : "#aaa", borderRadius: "8px 8px 0 0", transition: "all .15s"
    }),
    page: { padding: "20px 24px" },
    row: { display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 16 },
    card: { background: "#fff", border: "1px solid #e8e8e8", borderRadius: 12, padding: "16px 20px", flex: 1, minWidth: 140 },
    cardLabel: { fontSize: 12, color: "#888", fontWeight: 600, marginBottom: 4, textTransform: "uppercase", letterSpacing: ".5px" },
    cardValue: { fontSize: 28, fontWeight: 800, color: "#1a1a1a" },
    sectionTitle: { fontSize: 12, fontWeight: 700, color: "#999", textTransform: "uppercase", letterSpacing: "1px", margin: "24px 0 10px" },
    badge: (color) => ({ background: color+"22", color, fontSize: 13, fontWeight: 700, padding: "3px 10px", borderRadius: 20, display: "inline-block" }),
    btn: (color="#1a1a1a") => ({
      padding: "9px 18px", fontSize: 14, fontWeight: 700, border: "none",
      borderRadius: 8, background: color, color: "#fff", cursor: "pointer"
    }),
    input: { padding: "9px 12px", border: "1px solid #ddd", borderRadius: 8, fontSize: 14, width: "100%", boxSizing: "border-box", fontFamily: "'Barlow', sans-serif" },
    pill: (active, color) => ({
      padding: "6px 14px", borderRadius: 20, fontSize: 13, fontWeight: 600, cursor: "pointer", border: "none",
      background: active ? color : "#efefef", color: active ? "#fff" : "#555", transition: "all .15s"
    }),
    tableRow: (i) => ({ background: i%2===0 ? "#fafafa" : "#fff", borderBottom: "1px solid #f0f0f0" }),
    td: { padding: "10px 12px", fontSize: 14, color: "#333" },
    th: { padding: "10px 12px", fontSize: 11, fontWeight: 700, color: "#aaa", textTransform: "uppercase", letterSpacing: ".8px", textAlign: "left" },
  };

  if (loading) return (
    <div style={{ ...s.app, display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh" }}>
      <div style={{ textAlign: "center" }}>
        <div style={{ fontSize: 48, marginBottom: 12 }}>⚽</div>
        <div style={{ fontSize: 16, color: "#888" }}>Cargando Pichangueros 97…</div>
      </div>
    </div>
  );

  return (
    <div style={s.app}>
      <div style={s.header}>
        <p style={s.logo}>⚽ Pichangueros 97</p>
        <p style={s.sub}>Miércoles — Centro Casarinas, Surco</p>
        <div style={s.tabs}>
          {[["dashboard","Dashboard"],["convocatoria","Convocatoria"],["partido","Registrar partido"],["historial","Historial"],["goleadores","Goleadores"]].map(([key,label])=>(
            <button key={key} style={s.tab(tab===key)} onClick={()=>setTab(key)}>{label}</button>
          ))}
        </div>
      </div>

      <div style={s.page}>

        {tab==="dashboard" && (
          <div>
            <div style={s.row}>
              <div style={{...s.card, borderTop:`4px solid ${RED}`}}>
                <div style={s.cardLabel}>Rojos</div>
                <div style={{...s.cardValue, color:RED}}>{stats.rw}</div>
                <div style={{fontSize:12,color:"#aaa"}}>victorias</div>
              </div>
              <div style={{...s.card, borderTop:`4px solid ${GREEN}`}}>
                <div style={s.cardLabel}>Verdes</div>
                <div style={{...s.cardValue, color:GREEN}}>{stats.gw}</div>
                <div style={{fontSize:12,color:"#aaa"}}>victorias</div>
              </div>
              <div style={{...s.card, borderTop:`4px solid #ccc`}}>
                <div style={s.cardLabel}>Empates</div>
                <div style={s.cardValue}>{stats.draws}</div>
                <div style={{fontSize:12,color:"#aaa"}}>de {stats.total} partidos</div>
              </div>
              <div style={{...s.card, borderTop:`4px solid ${GOLD}`}}>
                <div style={s.cardLabel}>Goles totales</div>
                <div style={{...s.cardValue, color:GOLD}}>{stats.rg+stats.gg}</div>
                <div style={{fontSize:12,color:"#aaa"}}>{stats.total > 0 ? ((stats.rg+stats.gg)/stats.total).toFixed(1) : 0}/partido</div>
              </div>
            </div>

            <div style={s.sectionTitle}>Balance de victorias</div>
            <div style={{background:"#efefef", borderRadius:8, height:28, display:"flex", overflow:"hidden", marginBottom:8}}>
              {stats.total > 0 && <>
                <div style={{width:`${stats.rw/stats.total*100}%`, background:RED, display:"flex", alignItems:"center", justifyContent:"center", color:"#fff", fontSize:12, fontWeight:700, minWidth: stats.rw>0?24:0}}>{stats.rw>0?stats.rw:""}</div>
                <div style={{width:`${stats.draws/stats.total*100}%`, background:"#bbb", display:"flex", alignItems:"center", justifyContent:"center", color:"#fff", fontSize:12, fontWeight:700, minWidth: stats.draws>0?24:0}}>{stats.draws>0?stats.draws:""}</div>
                <div style={{width:`${stats.gw/stats.total*100}%`, background:GREEN, display:"flex", alignItems:"center", justifyContent:"center", color:"#fff", fontSize:12, fontWeight:700, minWidth: stats.gw>0?24:0}}>{stats.gw>0?stats.gw:""}</div>
              </>}
            </div>
            <div style={{display:"flex", gap:16, fontSize:12, color:"#888", marginBottom:8}}>
              <span>🔴 Rojos {stats.rw}V</span><span>⚪ Empates {stats.draws}</span><span>🟢 Verdes {stats.gw}V</span>
            </div>

            <div style={s.sectionTitle}>Top goleadores (histórico)</div>
            <div style={s.row}>
              {computeScorers([]).slice(0,3).map((p,i)=>(
                <div key={p.name} style={{...s.card, textAlign:"center", borderTop:`4px solid ${[GOLD,"#aaa","#cd7f32"][i]}`}}>
                  <div style={{fontSize:24, marginBottom:4}}>{"🥇🥈🥉"[i]}</div>
                  <div style={{fontWeight:700, fontSize:16}}>{p.name}</div>
                  <div style={{fontSize:28, fontWeight:800, color:[GOLD,"#aaa","#cd7f32"][i]}}>{p.goals}</div>
                  <div style={{fontSize:11, color:"#aaa"}}>goles</div>
                </div>
              ))}
            </div>

            {convocados.length > 0 && (
              <>
                <div style={s.sectionTitle}>Convocados este miércoles ({convocados.length})</div>
                <div style={{...s.card, marginBottom:16}}>
                  <div style={{display:"flex", flexWrap:"wrap", gap:6}}>
                    {convocados.map(n=>(<span key={n} style={s.badge(GREEN)}>{n}</span>))}
                  </div>
                </div>
              </>
            )}

            <div style={s.sectionTitle}>Últimos partidos</div>
            <table style={{width:"100%", borderCollapse:"collapse", background:"#fff", borderRadius:12, overflow:"hidden", border:"1px solid #e8e8e8"}}>
              <thead><tr style={{borderBottom:"1px solid #f0f0f0"}}>
                <th style={s.th}>Fecha</th><th style={{...s.th, color:RED}}>Rojos</th><th style={s.th}></th><th style={{...s.th, color:GREEN}}>Verdes</th><th style={s.th}>Resultado</th>
              </tr></thead>
              <tbody>
                {recentMatches.map((m,i)=>(
                  <tr key={m.id} style={s.tableRow(i)}>
                    <td style={s.td}>{m.date}</td>
                    <td style={{...s.td, fontWeight:800, color:RED, textAlign:"center", fontSize:18}}>{m.rojos}</td>
                    <td style={{...s.td, color:"#ccc", textAlign:"center"}}>—</td>
                    <td style={{...s.td, fontWeight:800, color:GREEN, textAlign:"center", fontSize:18}}>{m.verdes}</td>
                    <td style={s.td}><span style={s.badge(m.result==="Rojos"?RED:m.result==="Verdes"?GREEN:"#888")}>{m.result}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {tab==="convocatoria" && (
          <div>
            <div style={s.sectionTitle}>Importar desde WhatsApp con IA</div>
            <p style={{fontSize:13, color:"#777", marginTop:-4, marginBottom:8}}>Pega el texto del chat y la IA detecta quién confirmó asistencia.</p>
            <textarea value={aiText} onChange={e=>setAiText(e.target.value)} placeholder="Pega aquí el chat de WhatsApp..." style={{...s.input, height:120, resize:"vertical", marginBottom:8}}/>
            <button style={{...s.btn(), marginBottom:16}} onClick={runAI} disabled={aiLoading}>
              {aiLoading ? "Procesando…" : "🤖 Detectar convocados con IA"}
            </button>
            {aiResult && (
              <div style={{...s.card, marginBottom:16}}>
                <div style={{fontWeight:700, marginBottom:8}}>Detectados: {aiResult.join(", ")}</div>
                <button style={s.btn(GREEN)} onClick={confirmAI}>✓ Agregar a la lista</button>
              </div>
            )}

            <div style={s.sectionTitle}>Lista del miércoles — toca para marcar ({convocados.length} confirmados)</div>
            <div style={{display:"flex", flexWrap:"wrap", gap:8, marginBottom:20}}>
              {players.map(p=>(
                <button key={p} style={s.pill(convocados.includes(p), "#1a1a1a")} onClick={()=>toggleConv(p)}>{p}</button>
              ))}
            </div>

            {convocados.length > 0 && (
              <div style={s.card}>
                <div style={{fontWeight:700, marginBottom:8, color:GREEN}}>✓ Confirmados ({convocados.length})</div>
                <div style={{display:"flex", flexWrap:"wrap", gap:6, marginBottom:12}}>
                  {convocados.map(n=>(<span key={n} style={s.badge(GREEN)}>{n}</span>))}
                </div>
                <button style={{...s.btn("#e74c3c"), fontSize:12, padding:"6px 14px"}} onClick={clearConvocados}>Limpiar lista</button>
              </div>
            )}

            <div style={{...s.sectionTitle, marginTop:28}}>Agregar jugador nuevo al roster</div>
            <div style={{display:"flex", gap:8}}>
              <input value={newPlayer} onChange={e=>setNewPlayer(e.target.value)} placeholder="Nombre" style={{...s.input, maxWidth:220}} onKeyDown={e=>e.key==="Enter"&&addPlayer()}/>
              <button style={s.btn()} onClick={addPlayer}>Agregar</button>
            </div>
          </div>
        )}

        {tab==="partido" && (
          <div>
            <div style={s.sectionTitle}>Datos del partido</div>
            <div style={{marginBottom:16}}>
              <label style={{fontSize:13, color:"#666", display:"block", marginBottom:4}}>Nombre / Fecha</label>
              <input value={matchDate} onChange={e=>setMatchDate(e.target.value)} placeholder="Ej: Fecha 18 — 4 Jun 2025" style={{...s.input, maxWidth:360}}/>
            </div>

            <div style={s.row}>
              <div style={{flex:1, textAlign:"center"}}>
                <label style={{fontSize:13, color:RED, fontWeight:700, display:"block", marginBottom:8}}>🔴 Goles Rojos</label>
                <div style={{display:"flex", alignItems:"center", gap:12, justifyContent:"center"}}>
                  <button style={{...s.btn(RED), padding:"10px 18px", fontSize:20, borderRadius:50}} onClick={()=>setRojosScore(Math.max(0,rojosScore-1))}>−</button>
                  <span style={{fontSize:48, fontWeight:800, color:RED, minWidth:60, textAlign:"center"}}>{rojosScore}</span>
                  <button style={{...s.btn(RED), padding:"10px 18px", fontSize:20, borderRadius:50}} onClick={()=>setRojosScore(rojosScore+1)}>+</button>
                </div>
              </div>
              <div style={{display:"flex", alignItems:"center", fontSize:28, color:"#ddd", fontWeight:300, paddingTop:24}}>vs</div>
              <div style={{flex:1, textAlign:"center"}}>
                <label style={{fontSize:13, color:GREEN, fontWeight:700, display:"block", marginBottom:8}}>🟢 Goles Verdes</label>
                <div style={{display:"flex", alignItems:"center", gap:12, justifyContent:"center"}}>
                  <button style={{...s.btn(GREEN), padding:"10px 18px", fontSize:20, borderRadius:50}} onClick={()=>setVerdesScore(Math.max(0,verdesScore-1))}>−</button>
                  <span style={{fontSize:48, fontWeight:800, color:GREEN, minWidth:60, textAlign:"center"}}>{verdesScore}</span>
                  <button style={{...s.btn(GREEN), padding:"10px 18px", fontSize:20, borderRadius:50}} onClick={()=>setVerdesScore(verdesScore+1)}>+</button>
                </div>
              </div>
            </div>

            <div style={s.sectionTitle}>Goleadores — toca para agregar</div>
            <div style={{display:"flex", flexWrap:"wrap", gap:8, marginBottom:16}}>
              {(convocados.length > 0 ? convocados : players).map(p=>(
                <button key={p} style={s.pill(!!scorers.find(s=>s.name===p), "#1a1a1a")} onClick={()=>addScorer(p)}>
                  {p} {scorers.find(s=>s.name===p) ? `(${scorers.find(s=>s.name===p).goals})` : ""}
                </button>
              ))}
            </div>

            {scorers.length > 0 && (
              <div style={{marginBottom:20}}>
                {scorers.map(sc=>(
                  <div key={sc.name} style={{display:"flex", alignItems:"center", gap:10, padding:"10px 12px", background:"#fff", borderRadius:8, marginBottom:6, border:"1px solid #eee"}}>
                    <span style={{flex:1, fontWeight:700}}>{sc.name}</span>
                    <select value={sc.team} onChange={e=>updateScorerTeam(sc.name,e.target.value)} style={{border:"1px solid #ddd", borderRadius:6, padding:"5px 8px", fontSize:13, fontFamily:"'Barlow', sans-serif"}}>
                      <option value="rojos">🔴 Rojos</option>
                      <option value="verdes">🟢 Verdes</option>
                    </select>
                    <div style={{display:"flex", alignItems:"center", gap:6}}>
                      <button style={{...s.btn("#f0f0f0"), color:"#333", padding:"5px 12px"}} onClick={()=>updateScorerGoals(sc.name, sc.goals-1)}>−</button>
                      <span style={{fontWeight:800, minWidth:24, textAlign:"center", fontSize:16}}>{sc.goals}</span>
                      <button style={{...s.btn("#f0f0f0"), color:"#333", padding:"5px 12px"}} onClick={()=>updateScorerGoals(sc.name, sc.goals+1)}>+</button>
                    </div>
                    <button style={{...s.btn("#fee2e2"), color:RED, padding:"5px 12px", fontSize:12}} onClick={()=>removeScorer(sc.name)}>✕</button>
                  </div>
                ))}
              </div>
            )}

            <div style={{background:"#fff", borderRadius:10, padding:"14px 18px", marginBottom:20, border:"1px solid #eee", display:"flex", alignItems:"center", gap:12}}>
              <span style={{color:RED, fontWeight:800, fontSize:20}}>{rojosScore}</span>
              <span style={{color:"#ccc", fontSize:18}}>—</span>
              <span style={{color:GREEN, fontWeight:800, fontSize:20}}>{verdesScore}</span>
              <span style={s.badge(rojosScore>verdesScore?RED:verdesScore>rojosScore?GREEN:"#888")}>
                {rojosScore>verdesScore?"🔴 Rojos ganan":verdesScore>rojosScore?"🟢 Verdes ganan":"🤝 Empate"}
              </span>
            </div>

            <button style={{...s.btn(), padding:"13px 36px", fontSize:16}} onClick={saveMatch} disabled={saving}>
              {saving ? "Guardando…" : "💾 Guardar partido"}
            </button>
          </div>
        )}

        {tab==="historial" && (
          <div>
            <table style={{width:"100%", borderCollapse:"collapse", background:"#fff", borderRadius:12, overflow:"hidden", border:"1px solid #e8e8e8"}}>
              <thead><tr style={{borderBottom:"1px solid #f0f0f0"}}>
                <th style={s.th}>#</th>
                <th style={s.th}>Fecha</th>
                <th style={{...s.th, color:RED}}>Rojos</th>
                <th style={s.th}></th>
                <th style={{...s.th, color:GREEN}}>Verdes</th>
                <th style={s.th}>Resultado</th>
                <th style={s.th}>Goleadores</th>
              </tr></thead>
              <tbody>
                {[...matches].reverse().map((m,i)=>(
                  <tr key={m.id} style={s.tableRow(i)}>
                    <td style={{...s.td, color:"#ccc", fontSize:12}}>{m.id}</td>
                    <td style={{...s.td, fontWeight:600}}>{m.date}</td>
                    <td style={{...s.td, fontWeight:800, color:RED, textAlign:"center", fontSize:16}}>{m.rojos}</td>
                    <td style={{...s.td, color:"#ccc", textAlign:"center"}}>—</td>
                    <td style={{...s.td, fontWeight:800, color:GREEN, textAlign:"center", fontSize:16}}>{m.verdes}</td>
                    <td style={s.td}><span style={s.badge(m.result==="Rojos"?RED:m.result==="Verdes"?GREEN:"#888")}>{m.result}</span></td>
                    <td style={{...s.td, fontSize:12, color:"#888"}}>
                      {m.scorers && m.scorers.length > 0
                        ? m.scorers.map(s=>`${s.name}(${s.goals})`).join(", ")
                        : <span style={{color:"#ccc"}}>—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {tab==="goleadores" && (
          <div>
            <table style={{width:"100%", borderCollapse:"collapse", background:"#fff", borderRadius:12, overflow:"hidden", border:"1px solid #e8e8e8"}}>
              <thead><tr style={{borderBottom:"1px solid #f0f0f0"}}>
                <th style={s.th}>#</th>
                <th style={s.th}>Jugador</th>
                <th style={s.th}>Goles</th>
                <th style={s.th}>% del total</th>
              </tr></thead>
              <tbody>
                {computeScorers([]).map((p,i)=>(
                  <tr key={p.name} style={s.tableRow(i)}>
                    <td style={{...s.td, fontWeight:700, color:["#f39c12","#aaa","#cd7f32"][i]||"#ddd", width:40, fontSize:18}}>
                      {i<3 ? ["🥇","🥈","🥉"][i] : i+1}
                    </td>
                    <td style={{...s.td, fontWeight:700}}>{p.name}</td>
                    <td style={s.td}>
                      <div style={{display:"flex", alignItems:"center", gap:10}}>
                        <div style={{
                          width:`${Math.round(p.goals/computeScorers([])[0].goals*160)}px`,
                          height:8, borderRadius:4,
                          background: i===0?GOLD:i===1?"#aaa":i===2?"#cd7f32":"#e0e0e0",
                        }}/>
                        <span style={{fontWeight:800, fontSize:16}}>{p.goals}</span>
                      </div>
                    </td>
                    <td style={{...s.td, fontSize:12, color:"#aaa"}}>
                      {((p.goals/(stats.rg+stats.gg+171))*100).toFixed(1)}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

      </div>
    </div>
  );
}
