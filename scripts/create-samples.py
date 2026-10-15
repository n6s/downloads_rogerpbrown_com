from pathlib import Path
out=Path('samples')
out.mkdir(exist_ok=True)
(out/'Recording - sample download.txt').write_text('Harmless sample for testing private downloads.\nNo choir recording is included.\n')
# Dependency-free single-page PDF using only built-in Helvetica and ASCII text.
content=b'BT /F1 22 Tf 64 728 Td (Tenor download sample) Tj /F1 12 Tf 0 -40 Td (Harmless test PDF - no manuscript or music included.) Tj 0 -24 Td (Use the Download button to save this PDF.) Tj ET'
objects=[b'<< /Type /Catalog /Pages 2 0 R >>',b'<< /Type /Pages /Kids [3 0 R] /Count 1 >>',b'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',b'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',b'<< /Length '+str(len(content)).encode()+b' >>\nstream\n'+content+b'\nendstream']
pdf=b'%PDF-1.4\n'; offsets=[0]
for i,obj in enumerate(objects,1):
    offsets.append(len(pdf)); pdf+=f'{i} 0 obj\n'.encode()+obj+b'\nendobj\n'
xref=len(pdf)
pdf+=b'xref\n0 6\n0000000000 65535 f \n'+b''.join(f'{p:010d} 00000 n \n'.encode() for p in offsets[1:])
pdf+=f'trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n'.encode()
(out/'Tenors - sample manuscript.pdf').write_bytes(pdf)
