// Compartir el resultado de un partido: imagen (tarjeta con marcador y datos clave) y texto para WhatsApp.
import { t } from './i18n.js';
import { fmtDate, fmtPct } from './dom.js';
import { percentages, playerStats } from './stats.js';

export function shareText({ team, rival, date, away, c, top }) {
  const p = percentages(c);
  const [a, b] = away ? [rival, team] : [team, rival];
  const [ga, gb] = away ? [c.goals_against, c.goals] : [c.goals, c.goals_against];
  const lines = [`🤾 ${a} ${ga} – ${gb} ${b}`, `${fmtDate(date)} · ${away ? t('away') : t('home')}`, '',
    `${t('pct.shot_eff.short')}: ${fmtPct(p.shot_eff)} · ${t('pct.off_eff.short')}: ${fmtPct(p.off_eff)}`,
    `${t('pct.loss_pct.short')}: ${fmtPct(p.loss_pct)} · ${t('pct.save_pct.short')}: ${fmtPct(p.save_pct)}`];
  if (top.length) lines.push('', `⚽ ${top.map((x) => `${x.name} ${x.goals}`).join(' · ')}`);
  return lines.join('\n');
}

// Máximos goleadores del partido (hasta 3)
export function topScorers(events, nameOf) {
  return playerStats(events).filter((r) => r.player_id && r.goals > 0).sort((a, b) => b.goals - a.goals).slice(0, 3)
    .map((r) => ({ name: (nameOf(r.player_id) || '').replace(/^#\d+\s*/, ''), goals: r.goals }));
}

export function shareCard({ team, rival, date, away, c, top }) {
  const W = 1080, H = 1080, cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const g = cv.getContext('2d');
  g.fillStyle = '#E8140C'; g.fillRect(0, 0, W, 200);
  g.fillStyle = '#fff'; g.fillRect(0, 200, W, H - 200);
  g.fillStyle = '#fff'; g.textAlign = 'center';
  g.font = '700 54px system-ui, sans-serif'; g.fillText('Urdaibai E.T.', W / 2, 98);
  g.font = '400 36px system-ui, sans-serif'; g.fillText(`${fmtDate(date)} · ${away ? t('away') : t('home')}`, W / 2, 156);
  const fit = (txt, max, size) => { g.font = `700 ${size}px system-ui, sans-serif`; while (g.measureText(txt).width > max && size > 24) { size -= 2; g.font = `700 ${size}px system-ui, sans-serif`; } return txt; };
  const [a, b] = away ? [rival, team] : [team, rival];
  const [ga, gb] = away ? [c.goals_against, c.goals] : [c.goals, c.goals_against];
  g.fillStyle = '#1A1D21';
  g.fillText(fit(a, 440, 48), 270, 320); g.fillText(fit(b, 440, 48), 810, 320);
  g.font = '800 190px system-ui, sans-serif'; g.fillText(`${ga}`, 270, 520); g.fillText(`${gb}`, 810, 520);
  g.font = '700 90px system-ui, sans-serif'; g.fillText('–', W / 2, 500);
  const p = percentages(c);
  const tiles = [[t('pct.shot_eff.short'), p.shot_eff], [t('pct.off_eff.short'), p.off_eff], [t('pct.loss_pct.short'), p.loss_pct], [t('pct.save_pct.short'), p.save_pct]];
  tiles.forEach(([label, v], i) => {
    const x = 70 + i * 245;
    g.fillStyle = '#E6FBF3'; g.beginPath(); g.roundRect(x, 590, 225, 150, 22); g.fill();
    g.fillStyle = '#1A1D21'; g.font = '800 54px system-ui, sans-serif'; g.fillText(fmtPct(v), x + 112, 668);
    g.fillStyle = '#5B636C'; g.font = '600 30px system-ui, sans-serif'; g.fillText(label, x + 112, 716);
  });
  if (top.length) {
    g.fillStyle = '#1A1D21'; g.font = '700 38px system-ui, sans-serif'; g.fillText(`⚽ ${t('share.top')}`, W / 2, 830);
    g.font = '500 40px system-ui, sans-serif';
    top.forEach((x, i) => g.fillText(`${x.name} · ${x.goals}`, W / 2, 895 + i * 58));
  }
  return cv;
}

// Comparte con la hoja del móvil; si no existe, descarga la imagen y copia el texto
export async function shareMatch(info) {
  const text = shareText(info);
  const cv = shareCard(info);
  const blob = await new Promise((res) => cv.toBlob(res, 'image/png'));
  const file = blob ? new File([blob], `urdaibai-${info.date}.png`, { type: 'image/png' }) : null;
  try {
    if (file && navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file], text }); return 'shared'; }
    if (navigator.share) { await navigator.share({ text }); return 'shared'; }
  } catch (e) { if (e?.name === 'AbortError') return 'cancel'; }
  try { await navigator.clipboard?.writeText(text); } catch { /* sin portapapeles */ }
  if (blob) {
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = file.name; document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }
  return 'downloaded';
}
