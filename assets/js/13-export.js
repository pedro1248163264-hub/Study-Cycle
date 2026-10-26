/* =====================================================================
   assets/js/13-export.js — exportação dos dados salvos (trilhas e rodadas) em
   CSV e JSON.
   Depende de: 06-tracks.js, 07-storage.js, 08-speed-engine.js.
   Usado por: 14-ui.js.
   ===================================================================== */

const Export = {
  download(filename, content, mime){
    const blob = new Blob([content], {type:mime});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(()=>URL.revokeObjectURL(url), 2000);
  },
  csvText(){
    const rows = [['trilha','level','de','nivelada','concluida','patente','xp_barra','estrelas','meta_ms','mediana_recente_ms','acerto_recente','contas_total']];
    Object.keys(TRACKS).forEach(key=>{
      const tr = Store.data.tracks[key]; if(!tr) return;
      const acc = Engine.recentAccuracy(tr), med = Engine.recentMedian(tr);
      rows.push([trackLabel(key), tr.level, Engine.levelCount(key), tr.placed?'sim':'nao', tr.done?'sim':'nao', tr.rank,
        Math.round(tr.xp), Engine.starsTotal(tr), Math.round(Engine.goalMs(tr)), med==null?'':Math.round(med),
        acc==null?'':(acc*100).toFixed(1)+'%', tr.items]);
    });
    rows.push([]);
    rows.push(['rodada_data','concluida','contas','precisao','mediana_ms','dentro_da_meta','xp','estrelas','melhor_combo','trilhas']);
    Store.data.history.forEach(h=>{
      rows.push([new Date(h.date).toISOString(), h.completed===false?'nao':'sim', h.total, (h.accuracy*100).toFixed(1)+'%',
        Math.round(h.median||h.avgTime||0), h.targetRate==null?'':(h.targetRate*100).toFixed(1)+'%', h.xp==null?'':h.xp,
        h.stars==null?'':h.stars, h.bestCombo==null?'':h.bestCombo, (h.tracks||h.selectedSkills||[]).join('|')]);
    });
    return rows.map(r=>r.map(v=>`"${String(v).replace(/"/g,'""')}"`).join(',')).join('\n');
  },
  /* ---------- relatório para análise por IA ----------
     Texto em Markdown pensado para ser colado/enviado a uma IA: explica o app, define as
     métricas, traz agregados (por trilha, por semana, por level, por dia), marcos e o registro
     bruto das últimas contas — o bastante para ela julgar se há evolução de verdade. */
  aiReport(opts){
    const maxRaw = (opts && opts.rawRows) || 1500;
    const d = Store.data, log = d.log, lang = 'pt';
    const pct = v=>v==null||isNaN(v) ? '—' : Math.round(v*100)+'%';
    const f2 = v=>v==null||isNaN(v) ? '—' : (Math.round(v*100)/100).toFixed(2);
    const med = a=>a.length ? U.median(a) : null;
    const dayOf = t=>Progress.dayKey(t);
    const weekOf = t=>{ const k = dayOf(t), [y,m,dd] = k.split('-').map(Number), wd = new Date(y,m-1,dd,12).getDay(); return Progress.addDays(k, -((wd+6)%7)); };
    const rec = e=>({t:e[0], key:TRACK_ORDER[e[1]]||'?', level:e[2], m:e[3], ms:e[4], goal:e[5], ok:e[6]===1, zone:e[7], kind:e[8], lapse:e[9]===1});
    const rows = log.map(rec);
    // análise principal: treino e prova valem; aquecimento, reforço, nivelamento e lapsos ficam de fora
    const core = rows.filter(r=>(r.kind==='p'||r.kind==='t') && !r.lapse);
    const stats = a=>{
      const c = a.filter(r=>r.ok);
      return {n:a.length, acc:a.length?c.length/a.length:null, fast:a.length?a.filter(r=>r.zone==='f').length/a.length:null,
        ratio:med(c.map(r=>r.ms/r.goal)), meanLevel:a.length?U.mean(a.map(r=>r.level)):null};
    };
    const L = [];
    L.push('# Relatório do Mental Math para análise por IA','');
    L.push('## Instruções para a IA','');
    L.push('Você receberá os dados de UMA pessoa usando o app **Mental Math**, um treino de cálculo mental cujo objetivo é a pessoa virar uma "calculadora humana" (ganhar tempo em provas e no dia a dia). Analise se o app está funcionando, isto é, se há **evolução real** e se a **adaptação de dificuldade** se comporta como projetado.','');
    L.push('**Como o app funciona (resumo):**');
    L.push('- Cada operação é uma *trilha* com *levels* (ex.: Soma Nv 3 = "2 dígitos + 2 dígitos"). Cada level tem uma *meta de tempo* (`meta_ms`), que sobe com a dificuldade do level.');
    L.push('- Dentro do level há uma posição contínua `m` (0 = fácil do level, 1 = difícil). A cada conta ela anda um passo pequeno para manter a taxa de acerto-rápido perto de ρ* (padrão 82%; "Tranquilo" 90%, "Intenso" 72%). Sucesso = acerto com tempo ≤ 1,7× a meta.');
    L.push('- Zonas por conta correta, em razão tempo/meta: `f` (fast) ≤ 1,0 · `o` (ok) ≤ 1,7 · `s` (slow) > 1,7. Erro = `-`.');
    L.push('- O XP de cada acerto enche a barra do level; barra cheia + `m` ≥ 0,55 libera a *prova de nível* (8 contas; passa com ≥ 7 acertos e mediana ≤ 1,7× meta; 1–3 estrelas). Passar sobe o level; reprovar NUNCA derruba o level.');
    L.push('- Tipos de registro: `p` treino, `t` prova, `w` aquecimento (um level abaixo), `r` reforço (level anterior), `n` nivelamento inicial. Lapso (`lapso=1`) é erro de digitação/impulso e não conta como erro de cálculo.');
    L.push('- Contas com sinal (negativos) aparecem só nos últimos levels de subtração, multiplicação e divisão; potências/raízes só dentro de Expressões.','');
    L.push('**Sinais esperados se o app estiver funcionando:** (1) a razão mediana `tempo/meta` **cai** com o tempo num mesmo level; (2) o level médio **sobe** ao longo das semanas sem o acerto despencar; (3) o acerto fica perto de ρ* (nem ~100% — muito fácil —, nem < 60% — frustrante); (4) `m` não oscila em saltos; (5) provas aprovadas em sequência razoável; (6) regularidade (dias ativos, meta diária).','');
    L.push('**Responda, de forma objetiva:** 1) Há evolução? Em quais trilhas e quanto (use razão tempo/meta e level)? 2) A dificuldade está bem calibrada (acerto vs ρ*; trilhas fáceis/difíceis demais; metas de tempo de algum level parecem irreais)? 3) Há sinais de platô, fadiga, ou de que a pessoa está "esperando" a prova? 4) Anomalias nos dados (ex.: tempos suspeitos, rodadas muito curtas). 5) Ajustes concretos sugeridos (metas, constantes, conteúdo, hábito de treino). **Cuidado:** amostra de uma pessoa só; diferencie tendência de ruído e diga o quão confiante você está. Não invente números que não estejam abaixo.','');

    // ---- resumo ----
    const first = rows.length ? rows[0].t : null, last = rows.length ? rows[rows.length-1].t : null;
    const days = Object.keys(d.daily).filter(k=>d.daily[k].items>0);
    L.push('## Resumo geral','');
    L.push('- Gerado em: '+new Date().toISOString()+' · App v2 · idioma do app: '+d.settings.appLang);
    L.push('- Período coberto pelo registro de contas: '+(first?dayOf(first)+' a '+dayOf(last):'sem dados')+' ('+rows.length+' contas registradas; o registro guarda as últimas '+LOG_MAX+')');
    L.push('- Dias com treino: '+days.length+' · contas totais (histórico do app): '+d.player.items+' · rodadas: '+d.player.rounds+' · XP: '+d.player.xp+' · nível geral: '+Progress.levelInfo(d.player.xp).level);
    L.push('- Meta diária: '+d.settings.dailyGoal+' contas · sequência atual: '+Progress.currentStreak()+' dias · melhor: '+d.streak.best+' dias');
    L.push('- Ajustes relevantes: desafio='+d.settings.challenge+' (ρ*='+Engine.rho()+') · tamanho da rodada='+d.settings.roundSize+' · trilhas ativas='+Engine.activeKeys().join(', ')+' · aquecimento relâmpago='+(d.settings.masteryFlash?'ligado ('+d.settings.flashTracks.join(', ')+')':'desligado')+' · TTS='+(d.settings.tts?'ligado':'desligado'));
    const all = stats(core);
    L.push('- Contas de treino/prova (sem aquecimento/lapsos): n='+all.n+' · acerto '+pct(all.acc)+' · dentro da meta '+pct(all.fast)+' · mediana tempo/meta '+f2(all.ratio),'');

    // ---- estado atual por trilha ----
    L.push('## Estado atual por trilha','');
    L.push('| Trilha | Level | Nivelada | Estrelas | m | Barra XP | Meta do level | Mediana recente | Acerto recente | Prova liberada |');
    L.push('|---|---|---|---|---|---|---|---|---|---|');
    TRACK_ORDER.forEach(k=>{
      const tr = d.tracks[k]; if(!tr) return;
      const med0 = Engine.recentMedian(tr), acc0 = Engine.recentAccuracy(tr);
      L.push('| '+trackLabel(k)+' | '+(tr.done?'concluída (Mestre '+tr.rank+')':tr.level+'/'+Engine.levelCount(k))+' | '+(tr.placed?'sim':'não')+' | '+Engine.starsTotal(tr)+'/'+Engine.starsMax(k)+' | '+f2(tr.m)+' | '+Math.round(Engine.barFrac(tr)*100)+'% | '+Math.round(Engine.goalMs(tr))+' ms | '+(med0==null?'—':Math.round(med0)+' ms')+' | '+pct(acc0)+' | '+(tr.testReady?'sim':'não')+' |');
    });
    L.push('');

    // ---- evolução semanal (geral e por trilha) ----
    const weeks = [...new Set(core.map(r=>weekOf(r.t)))].sort();
    L.push('## Evolução por semana (segunda a domingo)','');
    L.push('Colunas: n = contas, acerto, "meta" = % das contas respondidas certas E dentro da meta de tempo, razão = mediana de (tempo ÷ meta) nos acertos (menor = mais rápido; < 1,0 = dentro da meta), Nv = level médio.','');
    L.push('| Semana | n | acerto | meta | razão | Nv |','|---|---|---|---|---|---|');
    weeks.forEach(w=>{ const a = stats(core.filter(r=>weekOf(r.t)===w)); L.push('| '+w+' | '+a.n+' | '+pct(a.acc)+' | '+pct(a.fast)+' | '+f2(a.ratio)+' | '+f2(a.meanLevel)+' |'); });
    L.push('');
    TRACK_ORDER.forEach(k=>{
      const rk = core.filter(r=>r.key===k); if(rk.length<8) return;
      L.push('### '+trackLabel(k)+' — por semana','','| Semana | n | acerto | meta | razão | Nv médio |','|---|---|---|---|---|---|');
      [...new Set(rk.map(r=>weekOf(r.t)))].sort().forEach(w=>{ const a = stats(rk.filter(r=>weekOf(r.t)===w)); L.push('| '+w+' | '+a.n+' | '+pct(a.acc)+' | '+pct(a.fast)+' | '+f2(a.ratio)+' | '+f2(a.meanLevel)+' |'); });
      L.push('');
    });

    // ---- por level: começo vs fim ----
    L.push('## Por trilha e level: início × fim (mesma dificuldade)','');
    L.push('Compara as primeiras e as últimas contas CORRETAS de cada level (até 15 de cada ponta). Queda da razão = ganho de velocidade.','');
    L.push('| Trilha | Level | n | acerto | razão início | razão fim | variação | 1ª vez | última vez |','|---|---|---|---|---|---|---|---|---|');
    TRACK_ORDER.forEach(k=>{
      const lv = [...new Set(core.filter(r=>r.key===k).map(r=>r.level))].sort((a,b)=>a-b);
      lv.forEach(l=>{
        const a = core.filter(r=>r.key===k && r.level===l); if(a.length<10) return;
        const c = a.filter(r=>r.ok), n15 = Math.min(15, Math.floor(c.length/2));
        const r0 = n15>=4 ? med(c.slice(0,n15).map(r=>r.ms/r.goal)) : null, r1 = n15>=4 ? med(c.slice(-n15).map(r=>r.ms/r.goal)) : null;
        L.push('| '+trackLabel(k)+' | '+l+' | '+a.length+' | '+pct(c.length/a.length)+' | '+f2(r0)+' | '+f2(r1)+' | '+(r0&&r1?(r1<r0?'−':'+')+Math.abs(Math.round((r1-r0)/r0*100))+'%':'—')+' | '+dayOf(a[0].t)+' | '+dayOf(a[a.length-1].t)+' |');
      });
    });
    L.push('');

    // ---- marcos ----
    L.push('## Marcos (nivelamento, provas, levels, patentes, reforços)','');
    if(!d.events.length) L.push('_Nenhum marco registrado ainda._');
    d.events.forEach(e=>{
      const tl = e.key ? trackLabel(e.key) : '';
      let tx = e.type;
      if(e.type==='placed') tx = 'nivelada no Nv '+e.level;
      else if(e.type==='test') tx = 'prova Nv '+e.level+': '+(e.pass?'APROVADA '+e.stars+'★':'reprovada')+' ('+e.correct+'/'+TEST_ITEMS+' acertos, '+e.hits+' dentro da meta, mediana '+(e.medianMs==null?'—':e.medianMs+' ms')+' vs meta '+Math.round(e.goalMs)+' ms)'+(e.retake?' [refazendo]':'');
      else if(e.type==='climb') tx = 'subida pedida p/ Nv '+e.level+': '+(e.pass?'APROVADA '+e.stars+'★':'não aprovada')+' ('+e.correct+'/'+e.total+' acertos, '+e.hits+' dentro da meta, mediana '+(e.medianMs==null?'—':e.medianMs+' ms')+' vs meta '+e.goalMs+' ms)';
      else if(e.type==='climbFailed') return;
      else if(e.type==='levelUp') tx = e.finished ? 'trilha concluída' : 'subiu do Nv '+e.level+' para o Nv '+e.newLevel;
      else if(e.type==='testFailed') tx = 'reprovou a prova do Nv '+e.level+' ('+e.correct+' acertos)';
      else if(e.type==='testReady') tx = 'prova do Nv '+e.level+' liberada';
      else if(e.type==='reinforce') tx = 'reforço no Nv '+e.level;
      else if(e.type==='rankUp') tx = 'patente Mestre '+e.rank;
      else if(e.type==='starsUp') tx = 'estrelas do Nv '+e.level+' agora '+e.stars;
      else if(e.type==='record') tx = 'recorde no Nv '+e.level+': '+Math.round(e.ms)+' ms (antes '+Math.round(e.prev)+')';
      if(['goal','playerLevel'].includes(e.type)) return;
      L.push('- '+new Date(e.t).toISOString().slice(0,16).replace('T',' ')+' · '+tl+' · '+tx);
    });
    L.push('');

    // ---- por dia e por rodada ----
    L.push('## Por dia (últimos 30 dias com treino)','','| Dia | contas | acertos | XP | meta batida |','|---|---|---|---|---|');
    days.sort().slice(-30).forEach(k=>{ const e = d.daily[k]; L.push('| '+k+' | '+e.items+' | '+e.correct+' | '+e.xp+' | '+(e.goalHit?'sim':'não')+' |'); });
    L.push('','## Últimas rodadas (até 40)','','| Data | concluída | contas | acerto | meta | mediana ms | XP | estrelas | combo |','|---|---|---|---|---|---|---|---|---|');
    d.history.slice(-40).forEach(h=>{ L.push('| '+new Date(h.date).toISOString().slice(0,16).replace('T',' ')+' | '+(h.completed===false?'não':'sim')+' | '+h.total+' | '+pct(h.accuracy)+' | '+pct(h.targetRate)+' | '+Math.round(h.median||h.avgTime||0)+' | '+(h.xp==null?'—':h.xp)+' | '+(h.stars==null?'—':h.stars)+' | '+(h.bestCombo==null?'—':h.bestCombo)+' |'); });
    L.push('');

    // ---- bruto ----
    L.push('## Registro bruto das últimas '+Math.min(maxRaw, rows.length)+' contas','');
    L.push('Colunas: `quando` (UTC), `trilha`, `level`, `m` (posição no level), `ms` (tempo de raciocínio), `meta_ms`, `acerto` (1/0), `zona` (f/o/s/-), `tipo` (p treino, t prova, c subida de level pedida (contas do level seguinte), w aquecimento, r reforço, n nivelamento), `lapso` (1 = erro de digitação, ignorar).','');
    L.push('```csv','quando,trilha,level,m,ms,meta_ms,acerto,zona,tipo,lapso');
    rows.slice(-maxRaw).forEach(r=>{ L.push([new Date(r.t).toISOString().slice(0,16), r.key, r.level, r.m, r.ms, r.goal, r.ok?1:0, r.zone, r.kind, r.lapse?1:0].join(',')); });
    L.push('```','');
    return L.join('\n');
  },
  aiReportDownload(){ this.download('mental_math_relatorio_ia.md', this.aiReport(), 'text/markdown'); },
  // Copia para a área de transferência (com plano B para navegadores sem a API).
  async aiReportCopy(){
    const text = this.aiReport();
    try{ await navigator.clipboard.writeText(text); return true; }
    catch(e){
      try{
        const ta = document.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
        document.body.appendChild(ta); ta.select(); const ok = document.execCommand('copy'); document.body.removeChild(ta); return ok;
      }catch(e2){ return false; }
    }
  },
  csv(){ this.download('mental_math_dados.csv', this.csvText(), 'text/csv'); },
  json(){ this.download('mental_math_dados.json', JSON.stringify(Store.data, null, 2), 'application/json'); }
};
