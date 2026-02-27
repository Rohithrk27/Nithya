import React from 'react';

export function Input({ className = '', ...props }) {
	return (
		<input
			className={`border rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-sky-400 ${className}`}
			{...props}
		/>
	);
}

export default Input;
