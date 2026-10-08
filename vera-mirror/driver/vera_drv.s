;;; ============================================================
;;; VERA Display Driver
;;;
;;; Initializes a VERA graphics/audio board (Adrian's Digital Basement
;;; VERA card for the Apple II, see C:\dev\a2vera) in slot 2. It initializes VERA's VGA output
;;; as a 640x480 1bpp bitmap and scales the
;;; double-hi-res (DHGR) framebuffer to fill VERA's VGA output.
;;;
;;; Current build assumes the card is present in slot 2. Automatic detection
;;; and the no-card fallback are not yet implemented in this version.
;;;
;;; VERA addressing: register access uses (VERA_ZP),Y indirect with
;;; VERA_ZP at $02/$03 (zero page cells unused by the DeskTop/MGTK,
;;; which use $06-$FF). DATA0 writes are always absolute `sta $Cn03`
;;; with the high byte patched at startup -- the indexed form performs
;;; a dummy read of DATA0 first, and reading DATA0 auto-increments the
;;; address pointer, so every byte would advance it twice. This is the
;;; same pattern the a2vera init programs use.
;;;
;;; DHGR layout: 560x192. Each row has 40 7-bit bytes in AUX and 40
;;; in MAIN; the display interleaves those bytes. A language-card helper
;;; gathers them in display order, then eight source bytes are packed into
;;; seven VERA 1bpp bytes (56 pixels).
;;; ============================================================

;;; --- VERA register offsets (used as Y indices into (VERA_ZP),Y) ----------
OFS_ADDR0_L = $00
OFS_ADDR0_M = $01
OFS_ADDR0_H = $02
OFS_CTRL    = $05
OFS_DC09    = $09        ; DC_VIDEO
OFS_DC0A    = $0A        ; DC_HSCALE
OFS_DC0B    = $0B        ; DC_VSCALE
OFS_DC0C    = $0C        ; DC_BORDER
OFS_L0CFG   = $0D        ; L0_CONFIG
OFS_L0MAP   = $0E        ; L0_MAPBASE (unused in bitmap mode)
OFS_L0TILE  = $0F        ; L0_TILEBASE (bitmap base + TILEW)
OFS_L0HSC_L = $10        ; L0_HSCROLL_L
OFS_L0HSC_H = $11        ; L0_HSCROLL_H / bitmap palette offset
OFS_L0VSC_L = $12        ; L0_VSCROLL_L
OFS_L0VSC_H = $13        ; L0_VSCROLL_H

;;; --- Geometry -------------------------------------------------------------
VERA_W      = 640
VERA_H      = 480
kDHRW       = 560        ; DeskTop width
kDHRH       = 192        ; DeskTop height
DHR_BYTES   = 40         ; bytes per DHGR row (560 / 14)
OUT_BYTES   = 70         ; VERA bytes per row (560 / 8)
TEXT_LINES  = 2          ; Number of text lines to render (menu bar)
TEXT_COLS   = 80         ; 80-column text mode
; VERA scales the 560x192 source to fill 640x480 at scanout.
H_OFF       = 0
V_OFF       = 0
H_SCALE     = $70       ; 560 source pixels -> 640 output pixels
V_SCALE     = $33       ; 192 source rows -> approximately 480 output rows
ROW_STRIDE  = VERA_W / 8                  ; 80 bytes per 1bpp row
V_DATA0     = $C203      ; DATA0 in slot 2 (patched dynamically if card in another slot)

VERA_ZP     := $02       ; 2 bytes ($02/$03): runtime VERA base = $CN00
SRC_ZP      := $04       ; 2 bytes ($04/$05): DHGR source row pointer

;;; Text memory base addresses
TEXT_BASE_MAIN := $400
TEXT_BASE_AUX  := $400

;;; --- Macro: write a VERA register (offset, value) via (VERA_ZP),Y ---------
.macro  vset ofs, val
        ldy     #ofs
        lda     #val
        sta     (VERA_ZP),y
.endmacro

;;; --- Macro: set ADDR0 (17-bit) with stride +1 ----------------------------
.macro  vaddr addr
        lda     #<addr
        ldy     #OFS_ADDR0_L
        sta     (VERA_ZP),y
        lda     #>addr
        ldy     #OFS_ADDR0_M
        sta     (VERA_ZP),y
        lda     #(((addr >> 16) & 1) | $10)
        ldy     #OFS_ADDR0_H
        sta     (VERA_ZP),y
.endmacro

;;; ============================================================
;;; vera_init: detect VERA, and if present initialize it.
;;; Called once at startup, after the desktop has been drawn.
;;; Sets `vera_enabled` so vera_present knows to blit.
;;; No-op (with vera_enabled=0) when no VERA is found.
;;; ============================================================
RDRAMRD        := $C013
RDRAMWRT       := $C014

.proc vera_blit
        lda     vera_enabled
        bne     :+
        rts
:
        php
        sei
        pha
        txa
        pha
        tya
        pha

        ;; Save zero page cells $02-$05 on stack
        lda     $02
        pha
        lda     $03
        pha
        lda     $04
        pha
        lda     $05
        pha

        jsr     ::vera_lc::vera_set_zp ; zero page base address setup

        ;; Save caller's softswitch state.
        lda     RD80STORE
        sta     save_80store
        lda     RDPAGE2
        sta     save_page2

        ;; Force RAMRDON and RAMWRTON so that:
        ;; 1. dhr_row_lo/hi and dhr_reverse7 are read from Aux RAM.
        ;; 2. packed_src ($BF71) and temporary variables write into Aux RAM.
        sta     RAMRDON
        sta     RAMWRTON

        ;; Force 80STORE ON and PAGE1 (MAIN) so (SRC_ZP),y in
        ;; vera_copy_dhr_row selects AUX/MAIN via HISCR/LOWSCR.
        lda     LOWSCR          ; select MAIN page before enabling 80STORE
        sta     SET80STORE      ; enable 80STORE mode
        lda     #$00
        sta     row_y
.blit_row:
        jsr     ::vera_lc::vera_row_addr ; out: SRC_ZP = main row address
        jsr     vera_row_convert
        inc     row_y
        lda     row_y
        cmp     #kDHRH
        bne     .blit_row

        ;; Restore caller's softswitch state.
        lda     LOWSCR          ; select page 1 before clearing 80STORE
        sta     CLR80STORE      ; clear 80STORE unconditionally
        bit     save_page2
        bpl     :+              ; bit 7 = 0 → PAGE2 was off
        lda     HISCR           ; restore PAGE2 ON
:       bit     save_80store
        bpl     :+              ; bit 7 = 0 → 80STORE was off
        sta     SET80STORE      ; restore 80STORE ON
:
        ;; Restore zero page cells $02-$05 from stack
        pla
        sta     $05
        pla
        sta     $04
        pla
        sta     $03
        pla
        sta     $02

        pla
        tay
        pla
        tax
        pla
        plp
        rts

save_80store:   .byte   0
save_page2:     .byte   0
.endproc ; vera_blit

;;; ============================================================
;;; vera_blit_now: `vera_blit` for callers that have not banked in LC bank 1.
;;;
;;; `vera_blit` calls `vera_set_zp` and `vera_row_addr`, which live in the
;;; language-card segment. Callers reached through `CallMainToAuxImpl`
;;; (`vera_check_present`) already have bank 1 selected, but MGTK's modal menu
;;; loops call this directly and can run with `LCBANK2` (directory FileRecords)
;;; still selected. Executing FileRecords at $D000 hits $00 and drops into the
;;; monitor with a beep.
;;;
;;; Leaves RAMRD/RAMWRT as AUX, which is what MGTK expects.
;;; ============================================================
.proc vera_blit_now
        lda     RDBNK2
        sta     vera_saved_bnk2
        bit     LCBANK1
        bit     LCBANK1
        jsr     vera_blit
        lda     vera_saved_bnk2
        bpl     :+              ; bit 7 = 0 -> LC bank 1 was already in use
        bit     LCBANK2
        bit     LCBANK2
:       rts
vera_saved_bnk2:  .byte   0
.endproc ; vera_blit_now

;;; ============================================================
;;; vera_row_convert: interleave one DHGR row (40 AUX + 40 MAIN bytes),
;;; then write 70 VERA bytes at the bitmap row start as ten
;;; blocks of (8 DHGR bytes -> 7 VERA bytes).
;;; ============================================================
.proc vera_row_convert
        ;; ADDR0 = row_y * ROW_STRIDE (80)
        lda     row_y
        sta     tmp_row
        lda     #$00
        sta     tmp_row+1
        jsr     ::vera_lc::vera_mul80 ; tmp_row *= 80

        ;; Gather AUX/MAIN pixels in display order. The helper executes
        ;; from language-card RAM, which is unaffected by RAMRD switching.
        jsr     ::vera_copy_dhr_row

        lda     tmp_row
        ldy     #OFS_ADDR0_L
        sta     (VERA_ZP),y
        lda     tmp_row+1
        ldy     #OFS_ADDR0_M
        sta     (VERA_ZP),y
        lda     #$10
        ldy     #OFS_ADDR0_H
        sta     (VERA_ZP),y

        ;; Eight source bytes (four AUX/MAIN pairs) become seven bytes.
        lda     #10
        sta     blk_count
        ldx     #0
.blk:   jsr     vera_block
        dec     blk_count
        bne     .blk
        rts
.endproc ; vera_row_convert

;;; ============================================================
;;; vera_block: convert eight packed 7-bit DHGR bytes into seven
;;; consecutive VERA bytes. X points into packed_src; advances by 8.
;;; ============================================================
.macro PACK_DHR_BYTE left, right, leftshift, rightshift, site
        ldy     packed_src+left,x
        lda     dhr_reverse7,y
        .repeat leftshift
        asl
        .endrepeat
        sta     blk_out
        ldy     packed_src+right,x
        lda     dhr_reverse7,y
        .repeat rightshift
        lsr
        .endrepeat
        ora     blk_out
::site: sta     V_DATA0
.endmacro

.proc vera_block
        PACK_DHR_BYTE 0, 1, 1, 6, vb0
        PACK_DHR_BYTE 1, 2, 2, 5, vb1
        PACK_DHR_BYTE 2, 3, 3, 4, vb2
        PACK_DHR_BYTE 3, 4, 4, 3, vb3
        PACK_DHR_BYTE 4, 5, 5, 2, vb4
        PACK_DHR_BYTE 5, 6, 6, 1, vb5
        PACK_DHR_BYTE 6, 7, 7, 0, vb6
        txa
        clc
        adc     #8
        tax
        rts
.endproc ; vera_block

;;; ============================================================
;;; Reverse the low seven bits: Apple II DHGR shifts bit 0 leftmost.
;;; Packing then treats the returned bit 6 as the first pixel.
dhr_reverse7:
.repeat 128, value
        .byte (((value & $01) << 6) | ((value & $02) << 4) | ((value & $04) << 2) | (value & $08) | ((value & $10) >> 2) | ((value & $20) >> 4) | ((value & $40) >> 6))
.endrepeat

;;; Reuse MGTK's canonical DHGR scanline address tables instead of keeping
;;; a second 384-byte copy in the already full auxiliary segment.
dhr_row_lo := mgtk::hires_table_lo
dhr_row_hi := mgtk::hires_table_hi

;;; Scratch (absolute, not zero page)
;;; ============================================================
vera_enabled:   .byte   0
vera_hi:        .byte   0
vera_probe_hi:  .byte   0
packed_src:     .res    80
row_y:          .byte   0
tmp_row:        .res    2
mul_tmp:        .res    2
blk_count:      .byte   0
blk_out:        .byte   0
