import { useEffect } from 'react';
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

export function TeamLogo({ src, name, size = 40 }: { src: string | null; name: string; size?: number }) {
  if (src) return <img src={src} alt={name} style={{ width: size, height: size }} className="team-logo-img" />;
  return <div className="team-logo-fallback" style={{ width: size, height: size, fontSize: size * 0.4 }}>{name.charAt(0).toUpperCase()}</div>;
}

export function PlayerPhoto({ src, name, size = 40 }: { src: string | null; name: string; size?: number }) {
  if (src) return <img src={src} alt={name} style={{ width: size, height: size }} className="player-photo-img" />;
  return <div className="player-photo-fallback" style={{ width: size, height: size, fontSize: size * 0.4 }}>{name.charAt(0).toUpperCase()}</div>;
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

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return <div className="modal-backdrop" onClick={onClose}><div className="modal-card" role="dialog" aria-modal="true" aria-label={title} onClick={(event) => event.stopPropagation()}><div className="modal-header"><h3>{title}</h3><button type="button" className="icon-button" onClick={onClose} aria-label="Fechar"><X size={16} /></button></div>{children}</div></div>;
}

export function ConfirmButton({ onConfirm, children, className }: { onConfirm: () => void; children: React.ReactNode; className?: string }) {
  return <button type="button" className={className || 'button button-ghost-danger'} onClick={() => { if (window.confirm('Tem certeza que deseja remover este item?')) onConfirm(); }}>{children}</button>;
}
