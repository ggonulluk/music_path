"""Sistem tepsisi ikonu (Windows), saf ctypes.

Paketlenmis surum konsolsuz calisiyor; kullanicinin uygulamanin acik
oldugunu gormesi, tarayiciyi tekrar acmasi ve kapatmasi icin tek yer bu.

pystray yerine ctypes: pystray LGPL-3.0, paketlenirse kullaniciya
kutuphaneyi degistirebilme hakki vermek gerekir (PyInstaller PYZ arsivinde
bu zahmetli). Ihtiyacimiz olan kisim - ikon, ipucu, menu, balon - kucuk.

Ana thread'de calismali: Win32 pencere mesajlari pencereyi yaratan
thread'e gelir.
"""
from __future__ import annotations

import ctypes
import ctypes.wintypes as wt
from typing import Callable, Optional

user32 = ctypes.WinDLL("user32", use_last_error=True)
shell32 = ctypes.WinDLL("shell32", use_last_error=True)
kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)

LRESULT = ctypes.c_ssize_t
WNDPROC = ctypes.WINFUNCTYPE(LRESULT, wt.HWND, wt.UINT, wt.WPARAM, wt.LPARAM)

WM_DESTROY = 0x0002
WM_CLOSE = 0x0010
WM_COMMAND = 0x0111
WM_TIMER = 0x0113
WM_LBUTTONUP = 0x0202
WM_RBUTTONUP = 0x0205
WM_APP = 0x8000
WM_TRAY = WM_APP + 1

NIM_ADD, NIM_MODIFY, NIM_DELETE = 0, 1, 2
NIF_MESSAGE, NIF_ICON, NIF_TIP, NIF_INFO = 0x1, 0x2, 0x4, 0x10
NIIF_INFO, NIIF_ERROR = 0x1, 0x3

IMAGE_ICON = 1
LR_LOADFROMFILE = 0x10
IDI_APPLICATION = 32512
MF_STRING, MF_SEPARATOR = 0x0, 0x800
TPM_RIGHTBUTTON, TPM_RETURNCMD, TPM_NONOTIFY = 0x2, 0x100, 0x80
SM_CXSMICON, SM_CYSMICON = 49, 50
MB_ICONERROR = 0x10

CMD_OPEN, CMD_FOLDER, CMD_QUIT = 1, 2, 3
TIMER_ID = 1


class GUID(ctypes.Structure):
    _fields_ = [("Data1", wt.DWORD), ("Data2", wt.WORD), ("Data3", wt.WORD),
                ("Data4", ctypes.c_ubyte * 8)]


class NOTIFYICONDATAW(ctypes.Structure):
    _fields_ = [
        ("cbSize", wt.DWORD), ("hWnd", wt.HWND), ("uID", wt.UINT),
        ("uFlags", wt.UINT), ("uCallbackMessage", wt.UINT), ("hIcon", wt.HICON),
        ("szTip", wt.WCHAR * 128), ("dwState", wt.DWORD), ("dwStateMask", wt.DWORD),
        ("szInfo", wt.WCHAR * 256), ("uVersion", wt.UINT),
        ("szInfoTitle", wt.WCHAR * 64), ("dwInfoFlags", wt.DWORD),
        ("guidItem", GUID), ("hBalloonIcon", wt.HICON),
    ]


class WNDCLASSW(ctypes.Structure):
    _fields_ = [
        ("style", wt.UINT), ("lpfnWndProc", WNDPROC), ("cbClsExtra", ctypes.c_int),
        ("cbWndExtra", ctypes.c_int), ("hInstance", wt.HINSTANCE), ("hIcon", wt.HICON),
        ("hCursor", wt.HANDLE), ("hbrBackground", wt.HBRUSH),
        ("lpszMenuName", wt.LPCWSTR), ("lpszClassName", wt.LPCWSTR),
    ]


# 64 bitte varsayilan int donusu tutamaclari kesiyor; imzalar acik olmali
user32.DefWindowProcW.argtypes = [wt.HWND, wt.UINT, wt.WPARAM, wt.LPARAM]
user32.DefWindowProcW.restype = LRESULT
user32.CreateWindowExW.argtypes = [
    wt.DWORD, wt.LPCWSTR, wt.LPCWSTR, wt.DWORD, ctypes.c_int, ctypes.c_int,
    ctypes.c_int, ctypes.c_int, wt.HWND, wt.HMENU, wt.HINSTANCE, wt.LPVOID]
user32.CreateWindowExW.restype = wt.HWND
user32.RegisterClassW.argtypes = [ctypes.POINTER(WNDCLASSW)]
user32.RegisterClassW.restype = wt.ATOM
user32.LoadImageW.argtypes = [wt.HINSTANCE, wt.LPCWSTR, wt.UINT,
                              ctypes.c_int, ctypes.c_int, wt.UINT]
user32.LoadImageW.restype = wt.HANDLE
user32.LoadIconW.argtypes = [wt.HINSTANCE, wt.LPVOID]
user32.LoadIconW.restype = wt.HICON
user32.CreatePopupMenu.restype = wt.HMENU
user32.AppendMenuW.argtypes = [wt.HMENU, wt.UINT, ctypes.c_size_t, wt.LPCWSTR]
user32.TrackPopupMenu.argtypes = [wt.HMENU, wt.UINT, ctypes.c_int, ctypes.c_int,
                                  ctypes.c_int, wt.HWND, wt.LPVOID]
user32.DestroyMenu.argtypes = [wt.HMENU]
user32.SetTimer.argtypes = [wt.HWND, ctypes.c_size_t, wt.UINT, wt.LPVOID]
user32.SetTimer.restype = ctypes.c_size_t
user32.KillTimer.argtypes = [wt.HWND, ctypes.c_size_t]
user32.DestroyWindow.argtypes = [wt.HWND]
user32.SetForegroundWindow.argtypes = [wt.HWND]
user32.PostMessageW.argtypes = [wt.HWND, wt.UINT, wt.WPARAM, wt.LPARAM]
user32.GetMessageW.argtypes = [ctypes.POINTER(wt.MSG), wt.HWND, wt.UINT, wt.UINT]
user32.TranslateMessage.argtypes = [ctypes.POINTER(wt.MSG)]
user32.DispatchMessageW.argtypes = [ctypes.POINTER(wt.MSG)]
user32.DispatchMessageW.restype = LRESULT
user32.RegisterWindowMessageW.argtypes = [wt.LPCWSTR]
user32.RegisterWindowMessageW.restype = wt.UINT
user32.MessageBoxW.argtypes = [wt.HWND, wt.LPCWSTR, wt.LPCWSTR, wt.UINT]
shell32.Shell_NotifyIconW.argtypes = [wt.DWORD, ctypes.POINTER(NOTIFYICONDATAW)]
shell32.Shell_NotifyIconW.restype = wt.BOOL
kernel32.GetModuleHandleW.argtypes = [wt.LPCWSTR]
kernel32.GetModuleHandleW.restype = wt.HMODULE


def message_box(text: str, title: str = "GgMix") -> None:
    """Konsol yokken hatayi kullaniciya gostermenin tek yolu."""
    user32.MessageBoxW(None, text, title, MB_ICONERROR)


class Tray:
    """Tepsi ikonu + mesaj dongusu.

    poll() her saniye cagrilir; (ipucu, balon) dondurur. Balon None degilse
    (baslik, metin, hata_mi) uclusu olarak bir kez gosterilir.
    """

    def __init__(self, icon_path: str, title: str,
                 on_open: Callable[[], None],
                 on_folder: Callable[[], None],
                 on_quit: Callable[[], None],
                 poll: Callable[[], tuple[str, Optional[tuple[str, str, bool]]]]):
        self.title = title
        self.on_open, self.on_folder, self.on_quit = on_open, on_folder, on_quit
        self.poll = poll
        self._tip = ""
        self.hwnd = None
        # Explorer yeniden baslarsa tepsi bosalir; bu mesajla ikonu geri
        # koyariz. CreateWindowExW'den ONCE: pencere olusurken WM_NCCREATE
        # vb. mesajlar _wndproc'a hemen geliyor, alan o anda var olmali
        self._wm_taskbar = user32.RegisterWindowMessageW("TaskbarCreated")
        # Callback nesnesi canli tutulmali; GC toplarsa Windows olu
        # bir isaretciyi cagirir ve surec sessizce coker
        self._proc = WNDPROC(self._wndproc)

        hinst = kernel32.GetModuleHandleW(None)
        wc = WNDCLASSW()
        wc.lpfnWndProc = self._proc
        wc.hInstance = hinst
        wc.lpszClassName = "GgMixTray"
        user32.RegisterClassW(ctypes.byref(wc))
        # Gorunmez pencere; sadece tepsi mesajlarini almak icin var
        self.hwnd = user32.CreateWindowExW(0, wc.lpszClassName, title, 0,
                                           0, 0, 0, 0, None, None, hinst, None)

        cx = user32.GetSystemMetrics(SM_CXSMICON)
        cy = user32.GetSystemMetrics(SM_CYSMICON)
        self.hicon = user32.LoadImageW(None, icon_path, IMAGE_ICON, cx, cy,
                                       LR_LOADFROMFILE)
        if not self.hicon:
            self.hicon = user32.LoadIconW(None, ctypes.c_void_p(IDI_APPLICATION))
        self._add()

    # ------------------------------------------------------------- tepsi

    def _nid(self, flags: int) -> NOTIFYICONDATAW:
        nid = NOTIFYICONDATAW()
        nid.cbSize = ctypes.sizeof(NOTIFYICONDATAW)
        nid.hWnd = self.hwnd
        nid.uID = 1
        nid.uFlags = flags
        return nid

    def _add(self) -> None:
        nid = self._nid(NIF_MESSAGE | NIF_ICON | NIF_TIP)
        nid.uCallbackMessage = WM_TRAY
        nid.hIcon = self.hicon
        nid.szTip = (self._tip or self.title)[:127]
        shell32.Shell_NotifyIconW(NIM_ADD, ctypes.byref(nid))

    def set_tip(self, text: str) -> None:
        if text == self._tip:
            return
        self._tip = text
        nid = self._nid(NIF_TIP)
        nid.szTip = text[:127]
        shell32.Shell_NotifyIconW(NIM_MODIFY, ctypes.byref(nid))

    def balloon(self, title: str, text: str, error: bool = False) -> None:
        nid = self._nid(NIF_INFO)
        nid.szInfoTitle = title[:63]
        nid.szInfo = text[:255]
        nid.dwInfoFlags = NIIF_ERROR if error else NIIF_INFO
        shell32.Shell_NotifyIconW(NIM_MODIFY, ctypes.byref(nid))

    def _menu(self) -> None:
        menu = user32.CreatePopupMenu()
        user32.AppendMenuW(menu, MF_STRING, CMD_OPEN, "GgMix'i aç")
        user32.AppendMenuW(menu, MF_STRING, CMD_FOLDER, "Şarkı klasörünü aç")
        user32.AppendMenuW(menu, MF_SEPARATOR, 0, None)
        user32.AppendMenuW(menu, MF_STRING, CMD_QUIT, "Çıkış")
        pt = wt.POINT()
        user32.GetCursorPos(ctypes.byref(pt))
        # Bu olmadan menu disina tiklayinca menu kapanmiyor (bilinen Win32 tuhafligi)
        user32.SetForegroundWindow(self.hwnd)
        cmd = user32.TrackPopupMenu(menu, TPM_RIGHTBUTTON | TPM_RETURNCMD | TPM_NONOTIFY,
                                    pt.x, pt.y, 0, self.hwnd, None)
        user32.DestroyMenu(menu)
        if cmd == CMD_OPEN:
            self.on_open()
        elif cmd == CMD_FOLDER:
            self.on_folder()
        elif cmd == CMD_QUIT:
            self.close()

    # ------------------------------------------------------------- dongu

    def _tick(self) -> None:
        try:
            tip, note = self.poll()
        except Exception:
            return
        self.set_tip(tip)
        if note:
            self.balloon(*note)

    def _wndproc(self, hwnd, msg, wparam, lparam):
        # ctypes callback'inden kacan istisna yutulur ve 0 doner; WM_NCCREATE
        # icin 0 "pencereyi yaratma" demek. Hata olursa varsayilana dus.
        try:
            return self._handle(hwnd, msg, wparam, lparam)
        except Exception:
            import traceback
            traceback.print_exc()
            return user32.DefWindowProcW(hwnd, msg, wparam, lparam)

    def _handle(self, hwnd, msg, wparam, lparam):
        if msg == WM_TRAY:
            if lparam == WM_LBUTTONUP:
                self.on_open()
            elif lparam == WM_RBUTTONUP:
                self._menu()
            return 0
        if msg == WM_TIMER:
            self._tick()
            return 0
        if msg == self._wm_taskbar:
            self._add()
            return 0
        if msg == WM_CLOSE:
            self.close()
            return 0
        if msg == WM_DESTROY:
            user32.PostQuitMessage(0)
            return 0
        return user32.DefWindowProcW(hwnd, msg, wparam, lparam)

    def close(self) -> None:
        """Ikonu kaldir, sunucuyu durdur, donguyu bitir. Tekrar cagrilabilir."""
        if not self.hwnd:
            return
        hwnd, self.hwnd = self.hwnd, None
        user32.KillTimer(hwnd, TIMER_ID)
        nid = NOTIFYICONDATAW()
        nid.cbSize = ctypes.sizeof(NOTIFYICONDATAW)
        nid.hWnd, nid.uID = hwnd, 1
        shell32.Shell_NotifyIconW(NIM_DELETE, ctypes.byref(nid))
        self.on_quit()
        user32.DestroyWindow(hwnd)

    def request_close(self) -> None:
        """Baska thread'den kapatma: mesaj kuyruguna birakir."""
        if self.hwnd:
            user32.PostMessageW(self.hwnd, WM_CLOSE, 0, 0)

    def run(self) -> None:
        # Saniyelik zamanlayici iki ise yariyor: ipucu/balon guncellemesi ve
        # Python'un sinyal isleyicilerine (Ctrl+C) firsat vermek - GetMessage
        # bloklarken Python kodu hic calismiyor.
        user32.SetTimer(self.hwnd, TIMER_ID, 1000, None)
        msg = wt.MSG()
        while user32.GetMessageW(ctypes.byref(msg), None, 0, 0) > 0:
            user32.TranslateMessage(ctypes.byref(msg))
            user32.DispatchMessageW(ctypes.byref(msg))
