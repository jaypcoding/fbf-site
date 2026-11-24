// Avatar editor (ready-made, customizable models; no image upload in this version).
// Live preview at the size used on the court and on the bench; saving writes
// only this player's avatar in this club (save_team_player_avatar).
import { useState } from 'react';
import { RotateCcw } from 'lucide-react';
import { AVATAR_COLORS, AVATAR_STYLES, AVATAR_SYMBOLS, defaultAvatar, type AvatarConfig, type RosterPlayer } from '@/lib/tactics';
import { FormError, Modal } from '@/components/ui';
import { AvatarDisc, MiniAvatar, SymbolGlyph } from './TacticsArt';

type Props = {
  player: RosterPlayer;
  current: AvatarConfig | null;
  onSave: (config: AvatarConfig | null) => Promise<{ ok: boolean; message?: string }>;
  onClose: () => void;
};

function Swatches({ label, value, onChange, id }: { label: string; value: string; onChange: (v: string) => void; id: string }) {
  return (
    <fieldset className="tac-swatches">
      <legend>{label}</legend>
      <div className="tac-swatch-row">
        {AVATAR_COLORS.map((c) => (
          <button key={c} type="button" className="tac-swatch" style={{ background: c }} aria-label={`${label}: ${c}`} aria-pressed={value === c} onClick={() => onChange(c)} />
        ))}
        <label className="tac-swatch-custom" htmlFor={id} title="Outra cor">
          <input id={id} type="color" value={value} onChange={(e) => onChange(e.target.value)} />
          <span>Outra</span>
        </label>
      </div>
    </fieldset>
  );
}

export function AvatarEditor({ player, current, onSave, onClose }: Props) {
  const base = current ?? defaultAvatar(player);
  const [cfg, setCfg] = useState<AvatarConfig>(base);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof AvatarConfig>(k: K, v: AvatarConfig[K]) => setCfg((c) => ({ ...c, [k]: v }));
  const dirty = JSON.stringify(cfg) !== JSON.stringify(base);

  async function save(config: AvatarConfig | null) {
    setBusy(true); setError(null);
    const r = await onSave(config);
    setBusy(false);
    if (r.ok) onClose(); else setError(r.message ?? 'Não foi possível salvar o avatar.');
  }

  return (
    <Modal title={`Avatar de ${player.nickname}`} onClose={onClose} wide>
      <div className="tac-avatar-editor">
        <div className="tac-avatar-preview" aria-label="Prévia do avatar">
          <svg viewBox="-60 -60 120 120" width="150" height="150" aria-hidden="true"><AvatarDisc config={cfg} r={48} number={player.shirt_number} uid="prev-big" /></svg>
          <div className="tac-avatar-preview-small">
            <MiniAvatar config={cfg} number={player.shirt_number} size={44} uid="prev-mid" />
            <MiniAvatar config={cfg} number={player.shirt_number} size={28} uid="prev-small" />
            <span>na quadra e no banco</span>
          </div>
        </div>
        <div className="tac-avatar-fields">
          <fieldset className="tac-symbols">
            <legend>Símbolo central</legend>
            <div className="tac-symbol-grid">
              {AVATAR_SYMBOLS.map((s) => (
                <button key={s.value} type="button" aria-pressed={cfg.symbol === s.value} onClick={() => set('symbol', s.value)} title={s.label}>
                  <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
                    {s.value === 'initial' ? <text x="12" y="16.5" textAnchor="middle" fontSize="13" fontWeight="700" fill="currentColor">{cfg.label || 'A'}</text>
                      : s.value === 'number' ? <text x="12" y="16.5" textAnchor="middle" fontSize="13" fontWeight="700" fill="currentColor">{player.shirt_number ?? '#'}</text>
                      : <SymbolGlyph symbol={s.value} color="currentColor" />}
                  </svg>
                  <span>{s.label}</span>
                </button>
              ))}
            </div>
          </fieldset>
          <div className="tac-avatar-row">
            <label className="tac-field" htmlFor="tac-label">
              <span>Inicial ou abreviação</span>
              <input id="tac-label" className="form-input" value={cfg.label} maxLength={3} onChange={(e) => set('label', e.target.value.replace(/[<>&"]/g, '').toUpperCase())} />
            </label>
            <fieldset className="tac-styles">
              <legend>Estilo</legend>
              {AVATAR_STYLES.map((s) => <button key={s.value} type="button" aria-pressed={cfg.style === s.value} onClick={() => set('style', s.value)}>{s.label}</button>)}
            </fieldset>
          </div>
          <Swatches label="Cor de fundo" value={cfg.background} onChange={(v) => set('background', v)} id="tac-bg" />
          <Swatches label="Cor da borda" value={cfg.border} onChange={(v) => set('border', v)} id="tac-border" />
          <label className="tac-check" htmlFor="tac-number">
            <input id="tac-number" type="checkbox" checked={cfg.show_number} onChange={(e) => set('show_number', e.target.checked)} disabled={player.shirt_number == null} />
            Mostrar o número da camisa{player.shirt_number == null ? ' (sem número no elenco)' : ` (${player.shirt_number})`}
          </label>
        </div>
      </div>
      <FormError message={error} />
      <div className="tac-modal-actions">
        {current && <button type="button" className="button button-outline button-small" disabled={busy} onClick={() => void save(null)}><RotateCcw size={14} aria-hidden="true" /> Voltar ao padrão</button>}
        <span className="tac-spacer" />
        <button type="button" className="button button-outline" onClick={onClose} disabled={busy}>Cancelar</button>
        <button type="button" className="button button-primary" disabled={busy || (!dirty && Boolean(current))} onClick={() => void save(cfg)}>{busy ? 'Salvando...' : 'Salvar avatar'}</button>
      </div>
    </Modal>
  );
}
