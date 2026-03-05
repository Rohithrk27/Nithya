import React from 'react';

export function Button({ children, className = '', variant = 'primary', size = 'md', type = 'button', ...props }) {
	const base = 'inline-flex items-center justify-center gap-2 rounded-md font-semibold transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/70 disabled:opacity-50 disabled:cursor-not-allowed';
	const sizes = {
		sm: 'h-8 px-3 text-xs',
		md: 'h-10 px-4 text-sm',
		lg: 'h-11 px-5 text-sm',
	};
	const variants = {
		primary: 'bg-sky-500 text-white hover:bg-sky-600',
		outline: 'border border-cyan-400/45 bg-cyan-400/10 text-cyan-100 hover:bg-cyan-400/20',
		ghost: 'bg-transparent text-slate-100 hover:bg-slate-700/40',
	};
	return (
		<button type={type} className={`${base} ${sizes[size] ?? sizes.md} ${variants[variant] ?? variants.primary} ${className}`} {...props}>
			{children}
		</button>
	);
}

export default Button;
