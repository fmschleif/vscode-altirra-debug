; Pure ATasm example. No external server or virtual-memory calls.
PTR     = $80
CH      = $02FC
SAVMSC  = $58
CLOCK   = $14
        *= $2000
START   cld
        lda #125
        jsr PUTCH
        lda #<TITLE
        ldx #>TITLE
        jsr PUTS
READY   nop                    ; first useful breakpoint
LOOP    lda CLOCK
        cmp LASTFRAME
        beq LOOP
        sta LASTFRAME
        inc COUNTER
        lda $D01F
        sta CONSOLEBYTE
        cmp PREVCONSOLE
        beq NOEVENT
        sta PREVCONSOLE
        cmp #7
        beq NOEVENT
        sta LASTCONSOLE
        inc CONSOLECOUNT
CONSOLEPRESS nop               ; stops only on a non-idle console-key change
NOEVENT lda COUNTER
REGTEST nop                    ; change A here, then step to STORE
STORE   sta OBSERVED
        jsr DRAW
        lda CH
        cmp #255
        beq LOOP
        sta LASTKEY
        inc KEYCOUNT
KEYPRESS nop                   ; LASTKEY is the Atari keyboard scan code
        lda #255
        sta CH
        jmp LOOP

DRAW    lda SAVMSC
        sta PTR
        lda SAVMSC+1
        sta PTR+1
        ldy #80                ; row 2, live counter in screen codes
        lda OBSERVED
        jsr HEX
        ldy #90
        lda LASTCONSOLE
        jsr HEX
        ldy #100
        lda KEYCOUNT
        jsr HEX
        ldy #110
        lda LASTKEY
        jsr HEX
        rts
HEX     pha
        lsr
        lsr
        lsr
        lsr
        tax
        lda DIGITS,x
        sta (PTR),y
        iny
        pla
        and #15
        tax
        lda DIGITS,x
        sta (PTR),y
        rts
PUTS    sta PTR
        stx PTR+1
PSLOOP  ldy #0
        lda (PTR),y
        beq PSDONE
        jsr PUTCH
        inc PTR
        bne PSLOOP
        inc PTR+1
        jmp PSLOOP
PSDONE  rts
PUTCH   sta OUTPUT
        ldx #0
        lda #11
        sta $0342,x
        lda #<OUTPUT
        sta $0344,x
        lda #>OUTPUT
        sta $0345,x
        lda #1
        sta $0348,x
        lda #0
        sta $0349,x
        jmp $E456
TITLE   .byte "ALTIRRA DEBUG - STANDALONE PLAYGROUND",155
        .byte "COUNT     CONSOLE   KEYS      LASTKEY",155,0
DIGITS  .byte 16,17,18,19,20,21,22,23,24,25,33,34,35,36,37,38
OUTPUT  .byte 0
COUNTER .byte 42
OBSERVED .byte 0
LASTFRAME .byte 0
LASTKEY .byte 255
KEYCOUNT .byte 0
CONSOLEBYTE .byte 7
PREVCONSOLE .byte 7
LASTCONSOLE .byte 7
CONSOLECOUNT .byte 0
BUFFER  .byte 0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15
        *= $02E0
        .word START
