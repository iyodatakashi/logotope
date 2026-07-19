import DOMPurify from 'isomorphic-dompurify';

export const convertToHtml = (value: string | number): string => {
	if (typeof value === 'string') {
		const escapedValue = escapeHtml(value);
		let html = escapedValue
			.replace(/ +/g, (match) => '&nbsp;'.repeat(match.length))
			.replace(/\n/g, '<br />');
		// 最後の行が空だったら空白を追加
		const lines = html.split('<br />');
		if (lines.length > 0 && lines[lines.length - 1] === '') {
			html += '&nbsp;';
		}
		return html;
	} else {
		return String(value);
	}
};

export const convertToLink = (str: string): string => {
	let text = str;
	text = text.replace(
		/((http|https|ftp):\/\/[\w?=&./#~%-;,*!$'():@+]+(?![\w\s?&./#~%";,=*'()-]*>))/g,
		'<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>'
	);
	return text;
};

export const escapeHtml = (value: string): string => {
	const map: Record<string, string> = {
		'&': '&amp;',
		'<': '&lt;',
		'>': '&gt;',
		'"': '&quot;',
		"'": '&#039;'
	};
	const escapedValue = value.replace(/[&<>"']/g, (m: string): string => map[m]);

	if (DOMPurify && typeof DOMPurify.sanitize === 'function') {
		return DOMPurify.sanitize(escapedValue);
	}

	return escapedValue;
};

export const convertToHtmlWithLink = (value: string | number): string => {
	if (typeof value === 'string') {
		const html = convertToHtml(value) as string;
		const htmlWithLink = convertToLink(html);
		return htmlWithLink;
	} else {
		return String(value);
	}
};
