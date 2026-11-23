import { useEffect, useState } from 'react';
import { ArrowRight, Pencil, Trash2 } from 'lucide-react';
import { supabase, type Streamer } from '@/lib/supabase';
import { LoadingCard, Modal, FormField, FormInput, FormSelect, FormError } from '@/components/ui';
import { refreshAdminData, useAdminDataVersion } from '@/lib/adminRefresh';
import { useConfirm } from '@/components/site';
import { STREAM_PLATFORMS, normalizeChannel, platformLabel } from '@/lib/streaming';

type Platform = Streamer['platform'];

type MatchOption = {
  id: string;
  scheduled_at: string | null;
  status: string;
  home_team: { team: { name: string } | null } | null;
  away_team: { team: { name: string } | null } | null;
};

export function StreamersTab() {
  const confirm = useConfirm();
  const refreshVersion = useAdminDataVersion();
  const [streamers, setStreamers] = useState<Streamer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Streamer | null>(null);
  const [linking, setLinking] = useState<Streamer | null>(null);
  const [newPlatform, setNewPlatform] = useState<Platform>('TWITCH');

  useEffect(() => {
    let active = true;
    supabase.from('streamers').select('id, display_name, platform, channel').order('display_name', { ascending: true }).then(({ data, error: err }) => {
      if (!active) return;
      if (err) setError('Não foi possível carregar os streamers.');
      else setStreamers((data || []) as Streamer[]);
      setLoading(false);
    });
    return () => { active = false; };
  }, [refreshVersion]);

  async function create(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const displayName = String(form.get('display_name') ?? '').trim();
    const channel = String(form.get('channel') ?? '').trim();
    const platform = String(form.get('platform') ?? 'TWITCH') as Platform;
    if (!displayName || !channel) { setError('Preencha o nome e o canal.'); return; }
    const normalized = normalizeChannel(platform, channel);
    if (!normalized.ok) { setError(normalized.message); return; }
    setError(null);
    const { error: err } = await supabase.from('streamers').insert({ display_name: displayName, channel: normalized.channel, platform });
    if (err) { setError('Não foi possível cadastrar o streamer.'); return; }
    formElement.reset();
    setNewPlatform('TWITCH');
    refreshAdminData();
  }

  async function remove(id: string) {
    if (!(await confirm({ title: 'Remover streamer', message: 'O streamer será excluído e desvinculado de todas as partidas.', confirmLabel: 'Remover streamer', tone: 'danger' }))) return;
    const { error: err } = await supabase.from('streamers').delete().eq('id', id);
    if (err) { setError('Não foi possível remover o streamer.'); return; }
    refreshAdminData();
  }

  return (
    <div className="admin-grid">
      <div className="admin-form-card">
        <h3>Novo streamer</h3>
        <form onSubmit={create}>
          <FormField label="Nome de exibição">
            <FormInput name="display_name" placeholder="Ex: Narrador Fulano" />
          </FormField>
          <FormField label="Plataforma">
            <FormSelect name="platform" value={newPlatform} onChange={(e) => setNewPlatform(e.target.value as Platform)}>
              {STREAM_PLATFORMS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
            </FormSelect>
          </FormField>
          <FormField label="Canal">
            <FormInput name="channel" placeholder={STREAM_PLATFORMS.find((p) => p.value === newPlatform)?.hint} />
          </FormField>
          <FormError message={error} />
          <button className="button button-primary">Cadastrar streamer <ArrowRight size={16} /></button>
        </form>
      </div>
      <div className="admin-list-card">
        <h3>Streamers</h3>
        {error && loading === false && streamers.length === 0 ? <FormError message={error} /> : loading ? <LoadingCard /> : streamers.length === 0 ? <p className="admin-empty-text">Nenhum streamer cadastrado ainda.</p> : (
          <div className="admin-list">
            {streamers.map((s) => (
              <div key={s.id} className="admin-list-item">
                <div>
                  <strong>{s.display_name}</strong>
                  <span>{platformLabel(s.platform)} · {s.channel}</span>
                </div>
                <div className="admin-list-actions">
                  <button className="button" onClick={() => setLinking(s)}>Partidas</button>
                  <button className="icon-button" onClick={() => setEditing(s)} title="Editar"><Pencil size={15} /></button>
                  <button className="icon-button-danger" onClick={() => remove(s.id)} title="Remover"><Trash2 size={15} /></button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      {editing && (
        <Modal title="Editar streamer" onClose={() => setEditing(null)}>
          <StreamerEditForm streamer={editing} onSaved={() => setEditing(null)} />
        </Modal>
      )}
      {linking && (
        <Modal title={`Partidas de ${linking.display_name}`} onClose={() => setLinking(null)}>
          <StreamerMatches streamer={linking} />
        </Modal>
      )}
    </div>
  );
}

function StreamerEditForm({ streamer, onSaved }: { streamer: Streamer; onSaved: () => void }) {
  const [displayName, setDisplayName] = useState(streamer.display_name);
  const [channel, setChannel] = useState(streamer.channel);
  const [platform, setPlatform] = useState<Platform>(streamer.platform);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!displayName.trim() || !channel.trim()) { setError('Preencha o nome e o canal.'); return; }
    // an unchanged channel of an existing streamer is kept as it is
    const unchanged = channel.trim() === streamer.channel && platform === streamer.platform;
    const normalized = unchanged ? { ok: true as const, channel: streamer.channel } : normalizeChannel(platform, channel);
    if (!normalized.ok) { setError(normalized.message); return; }
    setBusy(true); setError(null);
    const { error: err } = await supabase.from('streamers').update({ display_name: displayName.trim(), channel: normalized.channel, platform }).eq('id', streamer.id);
    setBusy(false);
    if (err) { setError('Não foi possível salvar as alterações.'); return; }
    refreshAdminData();
    onSaved();
  }

  return (
    <form onSubmit={save}>
      <FormField label="Nome de exibição">
        <FormInput value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
      </FormField>
      <FormField label="Plataforma">
        <FormSelect value={platform} onChange={(e) => setPlatform(e.target.value as Platform)}>
          {STREAM_PLATFORMS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
        </FormSelect>
      </FormField>
      <FormField label="Canal">
        <FormInput value={channel} placeholder={STREAM_PLATFORMS.find((p) => p.value === platform)?.hint} onChange={(e) => setChannel(e.target.value)} />
      </FormField>
      <FormError message={error} />
      <button className="button button-primary" disabled={busy}>{busy ? 'Aguarde...' : 'Salvar alterações'} <ArrowRight size={16} /></button>
    </form>
  );
}

function StreamerMatches({ streamer }: { streamer: Streamer }) {
  const refreshVersion = useAdminDataVersion();
  const [matches, setMatches] = useState<MatchOption[]>([]);
  const [linkedIds, setLinkedIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    Promise.all([
      supabase.from('matches').select('id, scheduled_at, status, home_team:home_team_id ( team:team_id ( name ) ), away_team:away_team_id ( team:team_id ( name ) )').order('scheduled_at', { ascending: true }),
      supabase.from('match_streamers').select('match_id').eq('streamer_id', streamer.id),
    ]).then(([matchRes, linkRes]) => {
      if (!active) return;
      if (matchRes.error || linkRes.error) setError('Não foi possível carregar as partidas.');
      setMatches((matchRes.data || []) as unknown as MatchOption[]);
      setLinkedIds(new Set(((linkRes.data || []) as { match_id: string }[]).map((l) => l.match_id)));
      setLoading(false);
    });
    return () => { active = false; };
  }, [streamer.id, refreshVersion]);

  async function toggle(matchId: string, linked: boolean) {
    setError(null);
    const { error: err } = linked
      ? await supabase.from('match_streamers').delete().eq('match_id', matchId).eq('streamer_id', streamer.id)
      : await supabase.from('match_streamers').insert({ match_id: matchId, streamer_id: streamer.id });
    if (err) { setError('Não foi possível atualizar esta partida.'); return; }
    setLinkedIds((prev) => {
      const next = new Set(prev);
      if (linked) next.delete(matchId); else next.add(matchId);
      return next;
    });
  }

  if (loading) return <LoadingCard />;
  if (matches.length === 0) return <p className="admin-empty-text">Nenhuma partida cadastrada.</p>;
  return (
    <div className="admin-list">
      <FormError message={error} />
      <p className="admin-hint">Quando uma partida marcada estiver ao vivo, o miniplayer deste streamer aparece em todas as páginas.</p>
      {matches.map((m) => {
        const linked = linkedIds.has(m.id);
        return (
          <label key={m.id} className="admin-list-item streamer-match-option">
            <div>
              <strong>{m.home_team?.team?.name || '—'} x {m.away_team?.team?.name || '—'}</strong>
              <span>{m.scheduled_at ? new Date(m.scheduled_at).toLocaleString('pt-BR') : 'Data a definir'}</span>
            </div>
            <input type="checkbox" checked={linked} onChange={() => toggle(m.id, linked)} />
          </label>
        );
      })}
    </div>
  );
}
