import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, X } from 'lucide-react';

export function LoadingCard() {
  return <div className="loading-card"><div className="loader" /><span>Carregando dados da FBF...</span></div>;
}

export function EmptyState({ icon, title, description, actionLabel, actionTo }: { icon: React.ReactNode; title: string; description: string; actionLabel?: string; actionTo?: string }) {
  return <div className="empty-state"><div className="empty-icon">{icon}</div><h2>{title}</h2><p>{description}</p>{actionLabel && actionTo && <Link to={actionTo} className="button button-dark">{actionLabel} <ArrowRight size={16} /></Link>}</div>;
}

export function PageIntro({ eyebrow, title, description }: { eyebrow: string; title: string; description: string }) {
  return <section className="page-intro"><div className="container"><span className="section-kicker">{eyebrow}</span><h1>{title}</h1><p>{description}</p></div></section>;
}

// Falls back to the initial when the image URL is missing or broken (a broken
// logo would otherwise show the alt text squeezed inside the circle).
function Avatar({ src, name, size, imgClass, fallbackClass }: { src: string | null; name: string; size: number; imgClass: string; fallbackClass: string }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  if (src && !failed) return <img src={src} alt={name} loading="lazy" decoding="async" onError={() => setFailed(true)} style={{ width: size, height: size }} className={imgClass} />;
  return <div className={fallbackClass} role="img" aria-label={name} style={{ width: size, height: size, fontSize: size * 0.4 }}>{name.charAt(0).toUpperCase()}</div>;
}

export function TeamLogo({ src, name, size = 40 }: { src: string | null; name: string; size?: number }) {
  return <Avatar src={src} name={name} size={size} imgClass="team-logo-img" fallbackClass="team-logo-fallback" />;
}

export function PlayerPhoto({ src, name, size = 40 }: { src: string | null; name: string; size?: number }) {
  return <Avatar src={src} name={name} size={size} imgClass="player-photo-img" fallbackClass="player-photo-fallback" />;
}

export function FormField({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="form-field"><span className="form-field-label">{label}</span>{children}</label>;
}

export function FormInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input className="form-input" {...props} />;
}

export function FormSelect(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className="form-select" {...props} />;
}

export function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return <div className="form-message">{message}</div>;
}

export function Modal({ title, onClose, children, wide = false }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return <div className="modal-backdrop" onClick={onClose}><div className={`modal-card${wide ? ' modal-card-wide' : ''}`} role="dialog" aria-modal="true" aria-label={title} onClick={(event) => event.stopPropagation()}><div className="modal-header"><h3>{title}</h3><button type="button" className="icon-button" onClick={onClose} aria-label="Fechar"><X size={16} /></button></div>{children}</div></div>;
}
