;;; VERA helpers placed in the language-card segment to keep the AUX
;;; desktop/toolkit segment within its 32 KB resident window.
.scope vera_lc

OFS_ADDR0_L = $00
OFS_ADDR0_M = $01
OFS_ADDR0_H = $02
OFS_CTRL    = $05
OFS_DC09    = $09
OFS_ADDR    = $03

.macro lc_vaddr addr
        lda     #<addr
        ldy     #OFS_ADDR0_L
        sta     (aux::VERA_ZP),y
        lda     #>addr
        ldy     #OFS_ADDR0_M
        sta     (aux::VERA_ZP),y
        lda     #(((addr >> 16) & 1) | $10)
        ldy     #OFS_ADDR0_H
        sta     (aux::VERA_ZP),y
.endmacro

.proc vera_detect
        lda     #$C1
        sta     aux::vera_probe_hi
.scan:
        lda     aux::vera_probe_hi
        sta     aux::VERA_ZP+1
        lda     #$00
        sta     aux::VERA_ZP
        lda     aux::vera_probe_hi
        cmp     #$C2
        beq     .identify
        cmp     #$C4
        beq     .identify
        ldy     #$05
.rdchk:
        lda     (aux::VERA_ZP),y
        bne     .notfound
        dey
        bpl     .rdchk
.identify:
        ldy     #OFS_CTRL
        lda     #$7E
        sta     (aux::VERA_ZP),y
        ldy     #OFS_DC09
        lda     (aux::VERA_ZP),y
        cmp     #$56
        bne     .restore
        lda     #$00
        ldy     #OFS_CTRL
        sta     (aux::VERA_ZP),y
        lda     aux::vera_probe_hi
        sta     aux::vera_hi
        sec
        rts
.restore:
        lda     #$00
        ldy     #OFS_CTRL
        sta     (aux::VERA_ZP),y
.notfound:
        inc     aux::vera_probe_hi
        lda     aux::vera_probe_hi
        cmp     #$C8
        bne     .scan
        clc
        rts
.endproc

.proc vera_patch_sites
        lda     aux::vera_hi
        sta     ::vb0+2
        sta     ::vb1+2
        sta     ::vb2+2
        sta     ::vb3+2
        sta     ::vb4+2
        sta     ::vb5+2
        sta     ::vb6+2
        sta     aux::VERA_ZP+1
        lda     #$00
        sta     aux::VERA_ZP
        rts
.endproc

.proc vera_set_zp
        lda     aux::vera_hi
        sta     aux::VERA_ZP+1
        lda     #$00
        sta     aux::VERA_ZP
        rts
.endproc

.proc vera_mark_dirty
        cpy     #MGTK::EventKind::no_event
        beq     .done
        lda     #1
        sta     vera_need_blit
.done:  rts
.endproc

.proc vera_present
        lda     aux::vera_enabled
        beq     .done
        lda     vera_need_blit
        beq     .done
        lda     #0
        sta     vera_need_blit
        jsr     aux::vera_blit
.done:  rts
.endproc

vera_need_blit: .byte 0

.proc GetTickCount
        RETURN  A=tick_counter, X=tick_counter+1, Y=tick_counter+2
.endproc

tick_counter: .faraddr 0

.proc vera_upload_palette
        jsr     vera_set_zp
        lc_vaddr $1FA00
        ldy     #OFS_ADDR
        lda     #$00
        sta     (aux::VERA_ZP),y   ; palette entry 0 low
        sta     (aux::VERA_ZP),y   ; palette entry 0 high
        lda     #$FF
        sta     (aux::VERA_ZP),y   ; palette entry 1 low
        lda     #$0F
        sta     (aux::VERA_ZP),y   ; palette entry 1 high
        rts
.endproc

.proc vera_row_addr
        ldy     aux::row_y
        lda     aux::dhr_row_hi,y
        clc
        adc     #$20
        sta     aux::SRC_ZP+1
        lda     aux::dhr_row_lo,y
        sta     aux::SRC_ZP
        rts
.endproc

.proc vera_mul80
        jsr     vera_shl_row
        jsr     vera_shl_row
        jsr     vera_shl_row
        jsr     vera_shl_row
        lda     aux::tmp_row
        sta     aux::mul_tmp
        lda     aux::tmp_row+1
        sta     aux::mul_tmp+1
        jsr     vera_shl_row
        jsr     vera_shl_row
        lda     aux::tmp_row
        clc
        adc     aux::mul_tmp
        sta     aux::tmp_row
        lda     aux::tmp_row+1
        adc     aux::mul_tmp+1
        sta     aux::tmp_row+1
        rts
.endproc

.proc vera_shl_row
        lda     aux::tmp_row
        asl
        sta     aux::tmp_row
        lda     aux::tmp_row+1
        rol
        sta     aux::tmp_row+1
        rts
.endproc

.endscope




.proc vera_patch_main_slot
        lda     aux::vera_hi
        pha                     ; preserve slot while switching ZP/main bank
        sta     RAMRDOFF
        sta     RAMWRTOFF
        pla
        sta     ::vera_main_slot
        sta     RAMRDON
        sta     RAMWRTON
        rts
.endproc
