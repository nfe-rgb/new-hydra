import React, { useMemo, useRef, useEffect, useState } from "react";
import { useStore } from "../lib/store.jsx";
import Modal from "../components/Modal.jsx";
import Portal from "../components/Portal.jsx";
import { formatCents } from "../lib/money.js";
import { gerarPdfRelatorioSemanal } from "../lib/pdfRelatorioSemanal.js";
import { downloadBlob } from "../lib/pdfOrcamento.js";
import { fmtDate, toDateOnlyTs } from "../lib/date.jsx";

/* helpers de período */
const toISO = (d) => {
  const x = new Date(d);
  x.setMinutes(x.getMinutes() - x.getTimezoneOffset());
  return x.toISOString().slice(0, 10);
};
const fmtISO = (iso) => String(iso).split("-").reverse().join("/");
const paidTs = (item) => item.paid_at || toDateOnlyTs(item.due_date);
function startOfDay(d){ const x=new Date(d); x.setHours(0,0,0,0); return x; }
function endOfDay(d){ const x=new Date(d); x.setHours(23,59,59,999); return x; }
function startOfWeek(d){ const x=new Date(d); const dow=x.getDay(); x.setDate(x.getDate()-dow); x.setHours(0,0,0,0); return x; }
function endOfWeek(d){ const x=startOfWeek(d); x.setDate(x.getDate()+6); x.setHours(23,59,59,999); return x; }
function startOfMonth(d){ const x=new Date(d); x.setDate(1); x.setHours(0,0,0,0); return x; }
function endOfMonth(d){ const x=new Date(d); x.setMonth(x.getMonth()+1); x.setDate(0); x.setHours(23,59,59,999); return x; }
function lastMonthRange(){ const t=new Date(); const f=new Date(t.getFullYear(), t.getMonth()-1, 1); return [startOfMonth(f), endOfMonth(f)]; }
function ymKey(dateISO){ const [Y,M] = String(dateISO).split("-"); return `${Y}-${M}`; }

export default function Financeiro(){
  const receivables = useStore(s=>s.receivables);
  const payables = useStore(s=>s.payables);
  const markRecPaid = useStore(s=>s.markRecPaid);
  const markPayPaid = useStore(s=>s.markPayPaid);
  const removeRec = useStore(s=>s.removeReceivable);
  const removePay = useStore(s=>s.removePayable);
  const cashOpening = useStore(s=>s.cashOpening);

  const [from, setFrom] = useState(()=> toISO(startOfMonth(new Date())));
  const [to, setTo] = useState(()=> toISO(endOfMonth(new Date())));
  const [showPicker, setShowPicker] = useState(false);
  const [tab, setTab] = useState("rec");
  const [confirmPay, setConfirmPay] = useState({ type:null, id:null });
  const [paidDate, setPaidDate] = useState(()=> toISO(new Date()));
  const [showWeeklyReport, setShowWeeklyReport] = useState(false);
  const [reportFrom, setReportFrom] = useState(()=> toISO(startOfWeek(new Date())));
  const [reportTo, setReportTo] = useState(()=> toISO(endOfWeek(new Date())));

  // PRESETS com Portal + posição fixa
  const [showPresets, setShowPresets] = useState(false);
  const triggerRef = useRef(null);
  const [panelPos, setPanelPos] = useState({ top: 80, left: 16, width: 240 });

  const openPresets = () => {
    const el = triggerRef.current;
    if (el) {
      const r = el.getBoundingClientRect();
      const vw = window.innerWidth;
      const width = 240;
      const left = Math.min(r.left, vw - width - 12);
      setPanelPos({ top: r.bottom + 8, left, width });
    }
    setShowPresets(true);
  };

  useEffect(() => {
    if (!showPresets) return;
    const sync = () => openPresets();
    window.addEventListener("resize", sync);
    window.addEventListener("scroll", sync, true);
    return () => {
      window.removeEventListener("resize", sync);
      window.removeEventListener("scroll", sync, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showPresets]);

  const applyPreset = (k) => {
    const now = new Date();
    if (k==="today"){ setFrom(toISO(startOfDay(now))); setTo(toISO(endOfDay(now))); }
    if (k==="week"){ setFrom(toISO(startOfWeek(now))); setTo(toISO(endOfWeek(now))); }
    if (k==="month"){ setFrom(toISO(startOfMonth(now))); setTo(toISO(endOfMonth(now))); }
    if (k==="lastMonth"){ const [a,b]=lastMonthRange(); setFrom(toISO(a)); setTo(toISO(b)); }
    setShowPresets(false);
  };

  const fromTs = useMemo(() => startOfDay(new Date(`${from}T00:00:00`)).getTime(), [from]);
  const toTs = useMemo(() => endOfDay(new Date(`${to}T00:00:00`)).getTime(), [to]);

  const rInRange = useMemo(()=> (receivables||[])
    .filter(r => {
      const dueTs = toDateOnlyTs(r.due_date);
      return dueTs >= fromTs && dueTs <= toTs;
    })
    .sort((a,b)=>toDateOnlyTs(a.due_date) - toDateOnlyTs(b.due_date)), [receivables, fromTs, toTs]);

  const rOpen = useMemo(()=> rInRange.filter(r=>r.status!=="paid"), [rInRange]);
  const rPaid = useMemo(()=> rInRange.filter(r=>r.status==="paid"), [rInRange]);

  const pInRange = useMemo(()=> (payables||[])
    .filter(r => {
      const dueTs = toDateOnlyTs(r.due_date);
      return dueTs >= fromTs && dueTs <= toTs;
    })
    .sort((a,b)=>toDateOnlyTs(a.due_date) - toDateOnlyTs(b.due_date)), [payables, fromTs, toTs]);

  const pOpen = useMemo(()=> pInRange.filter(p=>p.status!=="paid"), [pInRange]);
  const pPaid = useMemo(()=> pInRange.filter(p=>p.status==="paid"), [pInRange]);

  const sum = (arr, filter=()=>true) => arr.filter(filter).reduce((s,x)=> s + Number(x.amount_cents||0), 0);

  const entradasPrev = sum(rOpen);
  const saidasPrev = sum(pOpen);
  const entradasPagas = sum(rInRange, x=>x.status==="paid");
  const saidasPagas = sum(pInRange, x=>x.status==="paid");
  const entradasPagasAte = sum(receivables || [], r => r.status === "paid" && paidTs(r) <= toTs);
  const saidasPagasAte = sum(payables || [], p => p.status === "paid" && paidTs(p) <= toTs);
  const saldoReal = entradasPagasAte - saidasPagasAte;
  const saldoPrevisto = saldoReal + entradasPrev - saidasPrev;

  const reportRange = useMemo(() => {
    const fromDate = startOfDay(new Date(`${reportFrom}T00:00:00`));
    const toDate = endOfDay(new Date(`${reportTo}T00:00:00`));
    const start = fromDate.getTime() <= toDate.getTime() ? fromDate : startOfDay(toDate);
    const end = fromDate.getTime() <= toDate.getTime() ? toDate : endOfDay(fromDate);
    return {
      from: start,
      to: end,
      fromTs: start.getTime(),
      toTs: end.getTime(),
      fromISO: toISO(start),
      toISO: toISO(end),
    };
  }, [reportFrom, reportTo]);

  const entradasSemana = useMemo(() => (receivables || [])
    .filter(r => r.status === "paid")
    .map(r => ({ ...r, _ts: paidTs(r) }))
    .filter(r => r._ts >= reportRange.fromTs && r._ts <= reportRange.toTs)
    .sort((a, b) => a._ts - b._ts), [receivables, reportRange]);

  const saidasSemana = useMemo(() => (payables || [])
    .filter(p => p.status === "paid")
    .map(p => ({ ...p, _ts: paidTs(p) }))
    .filter(p => p._ts >= reportRange.fromTs && p._ts <= reportRange.toTs)
    .sort((a, b) => a._ts - b._ts), [payables, reportRange]);

  const reportMonthKey = ymKey(reportRange.fromISO);
  const saldoInicialSemana = useMemo(() => {
    const openingMonth = cashOpening[reportMonthKey] || 0;
    const monthStartTs = startOfMonth(reportRange.from).getTime();
    const recBefore = sum(receivables || [], r => r.status === "paid" && paidTs(r) >= monthStartTs && paidTs(r) < reportRange.fromTs);
    const payBefore = sum(payables || [], p => p.status === "paid" && paidTs(p) >= monthStartTs && paidTs(p) < reportRange.fromTs);
    return openingMonth + recBefore - payBefore;
  }, [cashOpening, reportMonthKey, receivables, payables, reportRange]);

  const entradasSemanaTotal = sum(entradasSemana);
  const saidasSemanaTotal = sum(saidasSemana);
  const saldoFinalSemana = saldoInicialSemana + entradasSemanaTotal - saidasSemanaTotal;

  const handleDownloadWeekly = () => {
    const entradas = entradasSemana.map(r => ({
      date: r._ts,
      amount_cents: r.amount_cents,
      label: `Cliente ${r.customer}${r.description ? ` - ${r.description}` : (r.method ? ` - ${r.method}` : "")}`,
    }));
    const saidas = saidasSemana.map(p => ({
      date: p._ts,
      amount_cents: p.amount_cents,
      label: `${p.description}${p.category ? ` (${p.category})` : ""}`,
    }));
    const { blob, fileName } = gerarPdfRelatorioSemanal({
      periodStart: reportRange.from,
      periodEnd: reportRange.to,
      openingCents: saldoInicialSemana,
      entradas,
      saidas,
      saldoFinalCents: saldoFinalSemana,
    });
    downloadBlob(blob, fileName);
    setShowWeeklyReport(false);
  };

  return (
    <div className="stack fade-in">
      {/* TOOLBAR */}
      <div className="card">
        <div className="toolbar">
          <div className="toolbar-start">
            <div style={{fontWeight:800, fontSize:18}}>Financeiro</div>
            <div className="muted" style={{fontSize:12}}>Filtre o período e gerencie lançamentos</div>
          </div>

          <div className="pill-group">
            <button ref={triggerRef} className="pill ripple" onClick={openPresets}>
              <span className="hint">Período</span><strong>Pré-definidos</strong>
            </button>

            {showPresets && (
              <Portal>
                <div className="popover-backdrop" onClick={()=>setShowPresets(false)} />
                <div
                  className="popover-fixed"
                  style={{ top: panelPos.top, left: panelPos.left, width: panelPos.width }}
                >
                  <div className="stack">
                    <button className="btn" onClick={()=>applyPreset("today")}>Hoje</button>
                    <button className="btn" onClick={()=>applyPreset("week")}>Esta semana</button>
                    <button className="btn" onClick={()=>applyPreset("month")}>Este mês</button>
                    <button className="btn" onClick={()=>applyPreset("lastMonth")}>Mês passado</button>
                    <button className="btn" onClick={()=>{ setShowPresets(false); setShowPicker(true); }}>Personalizado…</button>
                  </div>
                </div>
              </Portal>
            )}

            <div className="pill">
              <span className="hint">De</span><strong>{fmtISO(from)}</strong>
            </div>
            <div className="pill">
              <span className="hint">Até</span><strong>{fmtISO(to)}</strong>
            </div>
            <button className="btn ghost ripple" onClick={()=>setShowPicker(true)}>Alterar datas</button>
            <button
              className="btn primary ripple"
              onClick={()=>{
                setReportFrom(from);
                setReportTo(to);
                setShowWeeklyReport(true);
              }}
            >
              Relatorio por Periodo
            </button>
          </div>
        </div>
      </div>

      {/* TABS */}
      <div className="row">
        <button className={`btn ripple ${tab==="rec"?"primary":""}`} onClick={()=>setTab("rec")}>A Receber</button>
        <button className={`btn ripple ${tab==="pay"?"primary":""}`} onClick={()=>setTab("pay")}>A Pagar</button>
        <button className={`btn ripple ${tab==="fluxo"?"primary":""}`} onClick={()=>setTab("fluxo")}>Fluxo de Caixa</button>
      </div>

      {/* Listas */}
      {tab==="rec" && (
        <SectionReceber
          rOpen={rOpen}
          rPaid={rPaid}
          totalPrev={entradasPrev}
          entradasPagas={entradasPagas}
          onAskMark={(id)=>{ setConfirmPay({ type:"rec", id }); setPaidDate(toISO(new Date())); }}
          onRemove={async (id)=>{
            if (confirm("Excluir este recebivel?")) await removeRec(id);
          }}
        />
      )}
      {tab==="pay" && (
        <SectionPagar
          pInRange={pInRange}
          pOpen={pOpen}
          pPaid={pPaid}
          saidasPagas={saidasPagas}
          onAskMark={(id)=>{ setConfirmPay({ type:"pay", id }); setPaidDate(toISO(new Date())); }}
          onRemove={async (id)=>{
            if (confirm("Excluir este pagamento?")) await removePay(id);
          }}
        />
      )}
      {tab==="fluxo" && (
        <SectionFluxo
          entradasPagas={entradasPagas}
          saidasPagas={saidasPagas}
          saldoReal={saldoReal}
        />
      )}

      {/* Modal - confirmar pagamento */}
      <Modal open={!!confirmPay.id} onClose={()=>setConfirmPay({ type:null, id:null })} title="Confirmar pagamento">
        <div className="stack">
          <div className="muted">Informe a data em que o pagamento foi recebido/efetuado.</div>
          <input className="input" type="date" value={paidDate} onChange={e=>setPaidDate(e.target.value)} />
          <div style={{display:"flex", justifyContent:"flex-end", gap:8}}>
            <button className="btn ripple" onClick={()=>setConfirmPay({ type:null, id:null })}>Cancelar</button>
            <button
              className="btn primary ripple"
              onClick={async ()=>{
                if (confirmPay.type && confirmPay.id){
                  const ts = toDateOnlyTs(paidDate);
                  if (confirmPay.type==="rec") await markRecPaid(confirmPay.id, ts);
                  if (confirmPay.type==="pay") await markPayPaid(confirmPay.id, ts);
                }
                setConfirmPay({ type:null, id:null });
              }}
            >Confirmar</button>
          </div>
        </div>
      </Modal>

      {/* Modal - período personalizado */}
      <Modal open={showPicker} onClose={()=>setShowPicker(false)} title="Período personalizado">
        <div className="row">
          <div className="stack" style={{flex:1}}>
            <label className="muted" style={{fontSize:12}}>De</label>
            <input className="input" type="date" value={from} onChange={e=>setFrom(e.target.value)} />
          </div>
          <div className="stack" style={{flex:1}}>
            <label className="muted" style={{fontSize:12}}>Até</label>
            <input className="input" type="date" value={to} onChange={e=>setTo(e.target.value)} />
          </div>
        </div>
        <div style={{display:"flex", justifyContent:"flex-end", gap:8}}>
          <button className="btn ripple" onClick={()=>setShowPicker(false)}>Fechar</button>
        </div>
      </Modal>

      {/* Modal - Relatorio por periodo */}
      <Modal open={showWeeklyReport} onClose={()=>setShowWeeklyReport(false)} title="Relatorio por Periodo">
        <div className="stack">
          <div className="muted">Selecione o periodo para gerar o PDF.</div>
          <div className="row">
            <div className="stack" style={{flex:1}}>
              <label className="muted" style={{fontSize:12}}>De</label>
              <input
                className="input"
                type="date"
                value={reportRange.fromISO}
                onChange={(e)=>setReportFrom(e.target.value)}
              />
            </div>
            <div className="stack" style={{flex:1}}>
              <label className="muted" style={{fontSize:12}}>Ate</label>
              <input
                className="input"
                type="date"
                value={reportRange.toISO}
                onChange={(e)=>setReportTo(e.target.value)}
              />
            </div>
          </div>
          <div className="muted" style={{fontSize:12}}>
            Registro do periodo: {fmtISO(reportRange.fromISO)} a {fmtISO(reportRange.toISO)}
          </div>
          <div style={{display:"flex", justifyContent:"flex-end", gap:8}}>
            <button className="btn ripple" onClick={()=>setShowWeeklyReport(false)}>Cancelar</button>
            <button className="btn primary ripple" onClick={handleDownloadWeekly}>Baixar PDF</button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

/* Sub-seções (separei para deixar mais limpo) */
function SectionReceber({ rOpen, rPaid, totalPrev, entradasPagas, onAskMark, onRemove }){
  const sum = (arr)=>arr.reduce((s,x)=>s+Number(x.amount_cents||0),0);
  return (
    <div className="card slide-up">
      <div style={{display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:8}}>
        <strong>A Receber</strong>
          <div className="muted">Previsto: {formatCents(totalPrev)} • Recebidos: {formatCents(entradasPagas)}</div>
      </div>
      <div className="stack" style={{gap:16}}>
        <div>
          <div className="muted" style={{fontSize:12, marginBottom:4}}>Em aberto</div>
          <div className="table-card">
            {rOpen.length===0 && <div className="muted">Sem lançamentos em aberto.</div>}
            {rOpen.map((r)=>(
              <div key={r.id} className="table-row fade-in">
                <div style={{minWidth:90}}>{fmtDate(r.due_date)}</div>
                <div style={{flex:1}}>
                  <div>{r.customer}</div>
                  {r.description && <div className="muted" style={{fontSize:12}}>{r.description}</div>}
                </div>
                <div className="muted" style={{minWidth:90}}>{r.method}</div>
                <div style={{minWidth:130}}><strong>{formatCents(r.amount_cents)}</strong></div>
                <button className="btn ripple" onClick={()=>onAskMark(r.id)}>
                  Marcar pago
                </button>
                <button className="btn ghost ripple" onClick={()=>onRemove(r.id)}>
                  Excluir
                </button>
              </div>
            ))}
          </div>
        </div>

        <div>
          <div className="muted" style={{fontSize:12, marginBottom:4}}>Recebidos</div>
          <div className="table-card">
            {rPaid.length===0 && <div className="muted">Nenhum recebido no período.</div>}
            {rPaid.map((r)=>(
              <div key={r.id} className="table-row fade-in">
                <div style={{minWidth:90}}>{fmtDate(r.due_date)}</div>
                <div style={{flex:1}}>
                  <div>{r.customer}</div>
                  {r.description && <div className="muted" style={{fontSize:12}}>{r.description}</div>}
                </div>
                <div className="muted" style={{minWidth:90}}>{r.method}</div>
                <div style={{minWidth:130}}><strong>{formatCents(r.amount_cents)}</strong></div>
                <div className="muted" style={{minWidth:120}}>Recebido</div>
                <button className="btn ghost ripple" onClick={()=>onRemove(r.id)}>
                  Excluir
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function SectionPagar({ pInRange, pOpen, pPaid, saidasPagas, onAskMark, onRemove }){
  const sum = (arr)=>arr.reduce((s,x)=>s+Number(x.amount_cents||0),0);
  return (
    <div className="card slide-up">
      <div style={{display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:8}}>
        <strong>A Pagar</strong>
        <div className="muted">Total: {formatCents(sum(pInRange))} • Pagos: {formatCents(saidasPagas)}</div>
      </div>
      <div className="stack" style={{gap:16}}>
        <div>
          <div className="muted" style={{fontSize:12, marginBottom:4}}>Em aberto</div>
          <div className="table-card">
            {pOpen.length===0 && <div className="muted">Sem lançamentos em aberto.</div>}
            {pOpen.map((p)=>(
              <div key={p.id} className="table-row fade-in">
                <div style={{minWidth:90}}>{fmtDate(p.due_date)}</div>
                <div style={{flex:1}}>{p.description}</div>
                <div className="muted" style={{minWidth:90}}>{p.category||"Geral"}</div>
                <div style={{minWidth:130}}><strong>{formatCents(p.amount_cents)}</strong></div>
                <button className="btn ripple" onClick={()=>onAskMark(p.id)}>
                  Pagar
                </button>
                <button className="btn ghost ripple" onClick={()=>onRemove(p.id)}>
                  Excluir
                </button>
              </div>
            ))}
          </div>
        </div>

        <div>
          <div className="muted" style={{fontSize:12, marginBottom:4}}>Pagos</div>
          <div className="table-card">
            {pPaid.length===0 && <div className="muted">Nenhum pago no período.</div>}
            {pPaid.map((p)=>(
              <div key={p.id} className="table-row fade-in">
                <div style={{minWidth:90}}>{fmtDate(p.due_date)}</div>
                <div style={{flex:1}}>{p.description}</div>
                <div className="muted" style={{minWidth:90}}>{p.category||"Geral"}</div>
                <div style={{minWidth:130}}><strong>{formatCents(p.amount_cents)}</strong></div>
                <div className="muted" style={{minWidth:120}}>Pago</div>
                <button className="btn ghost ripple" onClick={()=>onRemove(p.id)}>
                  Excluir
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function SectionFluxo({ entradasPagas, saidasPagas, saldoReal }){
  const fmt = (v)=>formatCents(v);
  return (
    <div className="card slide-up">
      <div style={{display:"flex", justifyContent:"space-between", alignItems:"center", gap:12, flexWrap:"wrap", marginBottom:8}}>
        <strong>Fluxo de Caixa</strong>
      </div>
      <div className="stack" style={{gap:12}}>
        <div className="muted" style={{fontSize:12}}>Fluxo de Caixa (real)</div>
        <div className="row">
          <div className="kpi fade-in"><div className="label">Entradas recebidas</div><div className="value">{fmt(entradasPagas)}</div></div>
          <div className="kpi fade-in"><div className="label">Saídas realizadas</div><div className="value">{fmt(saidasPagas)}</div></div>
          <div className="kpi fade-in"><div className="label">Saldo atual</div><div className="value">{fmt(saldoReal)}</div></div>
        </div>
      </div>
    </div>
  );
}
