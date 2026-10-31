// 示例程序。运行结束时用 brk #0 停机；向 0x7ff8 写入的值会显示在“输出”中。

export interface Example {
  id: string;
  title: string;
  focus: string;
  source: string;
}

export const EXAMPLES: Example[] = [
  {
    id: 'sum',
    title: '数组求和（LDR + 循环）',
    focus: 'LDR 寄存器偏移寻址、ADD、CMP + B.LT 循环、缓存行命中',
    source: `// 对 data 中的 8 个数求和，结果放在 x0 并输出
_start:
    adr  x1, data        // x1 = 数组首地址
    mov  x2, #0          // i = 0
    mov  x0, #0          // sum = 0
    mov  x3, #8          // n = 8
loop:
    ldr  x4, [x1, x2, lsl #3]   // x4 = data[i]
    add  x0, x0, x4
    add  x2, x2, #1
    cmp  x2, x3
    b.lt loop
    mov  x5, #0x7ff8     // 输出端口
    str  x0, [x5]
    brk  #0
data:
    .quad 3, 1, 4, 1, 5, 9, 2, 6
`,
  },
  {
    id: 'store',
    title: '写内存（STR）与读回',
    focus: 'STR 写入、写后读命中同一缓存行、栈指针 SP',
    source: `// 在栈上写入两个值，再读回相加
_start:
    sub  sp, sp, #16
    mov  x0, #40
    mov  x1, #2
    str  x0, [sp]
    str  x1, [sp, #8]
    ldr  x2, [sp]
    ldr  x3, [sp, #8]
    add  x4, x2, x3      // 42
    add  sp, sp, #16
    mov  x5, #0x7ff8
    str  x4, [x5]
    brk  #0
`,
  },
  {
    id: 'call',
    title: '函数调用（BL / RET）',
    focus: 'BL 写入 x30 返回地址、RET 跳回、MUL',
    source: `// square(7) = 49
_start:
    mov  x0, #7
    bl   square
    mov  x5, #0x7ff8
    str  x0, [x5]
    brk  #0
square:
    mul  x0, x0, x0
    ret
`,
  },
  {
    id: 'fib',
    title: '斐波那契（分支与标志位）',
    focus: 'SUBS 设置 NZCV、CBNZ、寄存器依赖',
    source: `// 依次输出前 10 个斐波那契数
_start:
    mov  x0, #0
    mov  x1, #1
    mov  x2, #10
    mov  x5, #0x7ff8
next:
    str  x0, [x5]
    add  x3, x0, x1
    mov  x0, x1
    mov  x1, x3
    subs x2, x2, #1
    cbnz x2, next
    brk  #0
`,
  },
  {
    id: 'stride',
    title: '跨步访存（缓存未命中实验）',
    focus: '改变步长观察 L1 命中率：步长 8 字节 vs 128 字节',
    source: `// 以 stride 字节为步长读取 64 次。改 stride 再运行，比较 L1 命中率
_start:
    mov  x1, #0x4000     // 缓冲区起始
    mov  x2, #0          // 偏移
    mov  x3, #64         // 次数
    mov  x6, #128        // stride（试试 8 / 64 / 128 / 256）
loop:
    ldr  x4, [x1, x2]
    add  x2, x2, x6
    subs x3, x3, #1
    b.ne loop
    brk  #0
`,
  },
];
