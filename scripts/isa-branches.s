_start:
  b fwd
  bl fwd
  b.eq fwd
  b.ne back
  b.lt fwd
  b.ge back
  b.gt fwd
  b.le back
  b.hs fwd
  b.lo back
  b.hi fwd
  b.ls back
  b.mi fwd
  b.pl back
  cbz x0, fwd
  cbnz x19, back
  adr x2, fwd
  adr x3, back
back:
  nop
  b back
  b _start
fwd:
  nop
