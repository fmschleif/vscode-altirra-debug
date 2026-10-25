/* Altirra Debug IPC helper, GPL-3.0-only. Uses Altirra's existing WM_COPYDATA
 * command-line protocol, plus display-only capture and directed keyboard events.
 * No desktop capture, global input injection or focus changes.
 * stdin: little-endian uint32 size, followed by the protocol payload.
 * stdout: startup magic 0x31425049, then one uint32 error code per request.
 */
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <stdint.h>
#include <stdlib.h>

static HWND target;
static unsigned count;
static DWORD target_pid;
static BOOL CALLBACK find_target(HWND hwnd, LPARAM ignored) {
    WCHAR name[64];
    (void)ignored;
    if(GetClassNameW(hwnd,name,64) && !lstrcmpW(name,L"AltirraMainWindow")) {
        DWORD pid=0;GetWindowThreadProcessId(hwnd,&pid);
        if(!target_pid||pid==target_pid){target=hwnd; ++count;}
    }
    return TRUE;
}
static int read_all(HANDLE h, void *data, DWORD size) {
    BYTE *p=(BYTE*)data;
    while(size) {
        DWORD n=0;
        if(!ReadFile(h,p,size,&n,NULL)||!n)return 0;
        p+=n; size-=n;
    }
    return 1;
}
static int write_code(HANDLE h, uint32_t code) {
    DWORD n=0;
    return WriteFile(h,&code,4,&n,NULL)&&n==4;
}
static HWND display;
static BYTE held[256];
static BOOL CALLBACK find_display(HWND hwnd, LPARAM unused) {
    WCHAR name[64]; (void)unused;
    if(GetClassNameW(hwnd,name,64) && !lstrcmpW(name,L"phaeronVideoDisplay"))display=hwnd;
    return TRUE;
}
static uint32_t capture(void) {
    RECT rc; HDC src=NULL,dc=NULL; HBITMAP bmp=NULL; HGDIOBJ old=NULL;
    BITMAPINFO bi={0}; BITMAPFILEHEADER hdr={0}; void *pixels=NULL;
    HANDLE file=INVALID_HANDLE_VALUE; DWORD n=0; uint32_t error=0xA003;
    if(IsIconic(target)||!GetClientRect(display,&rc)||rc.right<=0||rc.bottom<=0)return error;
    int w=rc.right,h=rc.bottom;
    if(w>8192||h>8192)return error;
    if(w>672||h>480) {double scale=672.0/w;if(480.0/h<scale)scale=480.0/h;w=(int)(w*scale);h=(int)(h*scale);if(w<1||h<1)return error;}
    bi.bmiHeader.biSize=sizeof(BITMAPINFOHEADER);bi.bmiHeader.biWidth=w;
    bi.bmiHeader.biHeight=-h;bi.bmiHeader.biPlanes=1;bi.bmiHeader.biBitCount=32;
    src=GetDC(display);dc=CreateCompatibleDC(src);
    bmp=CreateDIBSection(dc,&bi,DIB_RGB_COLORS,&pixels,NULL,0);
    if(!bmp)goto done;
    old=SelectObject(dc,bmp);
    /* Capture only the emulator display surface, including its paused raster.
       GDI is explicitly selected in our isolated Altirra profile. */
    SetStretchBltMode(dc,COLORONCOLOR);
    if(!StretchBlt(dc,0,0,w,h,src,0,0,rc.right,rc.bottom,SRCCOPY))goto done;
    hdr.bfType=0x4D42;hdr.bfOffBits=sizeof(hdr)+sizeof(BITMAPINFOHEADER);
    hdr.bfSize=hdr.bfOffBits+w*h*4;
    file=CreateFileW(L"native-display.tmp",GENERIC_WRITE,0,NULL,CREATE_ALWAYS,FILE_ATTRIBUTE_NORMAL,NULL);
    if(file==INVALID_HANDLE_VALUE)goto done;
    if(!WriteFile(file,&hdr,sizeof(hdr),&n,NULL)||n!=sizeof(hdr))goto done;
    if(!WriteFile(file,&bi.bmiHeader,sizeof(BITMAPINFOHEADER),&n,NULL)||n!=sizeof(BITMAPINFOHEADER))goto done;
    if(!WriteFile(file,pixels,w*h*4,&n,NULL)||n!=(DWORD)(w*h*4))goto done;
    CloseHandle(file);file=INVALID_HANDLE_VALUE;
    if(MoveFileExW(L"native-display.tmp",L"native-display.bmp",MOVEFILE_REPLACE_EXISTING))error=0;
 done:
    if(file!=INVALID_HANDLE_VALUE)CloseHandle(file);
    if(old)SelectObject(dc,old);
    if(bmp)DeleteObject(bmp);
    if(dc)DeleteDC(dc);
    if(src)ReleaseDC(display,src);
    return error;
}
static uint32_t key(unsigned vk,unsigned ch,int down,int repeat) {
    DWORD_PTR result=0;HWND pane=GetParent(display);
    if(vk>255||ch>0xFFFF)return 0xA004;
    LPARAM lp=1|((LPARAM)MapVirtualKeyW(vk,MAPVK_VK_TO_VSC)<<16);
    if(vk>=VK_PRIOR&&vk<=VK_DOWN)lp|=1<<24;
    if(repeat)lp|=1<<30;
    if(!down)lp|=(LPARAM)0xC0000000;
    if(!SendMessageTimeoutW(pane,WM_APP+(down?207:208),vk,lp,SMTO_ABORTIFHUNG|SMTO_BLOCK,1000,&result))return 0xA004;
    if(down && ch && !result) {
        if(!SendMessageTimeoutW(pane,WM_CHAR,ch,lp,SMTO_ABORTIFHUNG|SMTO_BLOCK,1000,&result))return 0xA004;
    }
    held[vk]=down?1:0;
    return 0;
}
int main(int argc,char **argv) {
    if(argc==3 && !lstrcmpA(argv[1],"--target-pid"))target_pid=(DWORD)strtoul(argv[2],NULL,10);
    HANDLE input=GetStdHandle(STD_INPUT_HANDLE), output=GetStdHandle(STD_OUTPUT_HANDLE);
    SetErrorMode(SEM_FAILCRITICALERRORS|SEM_NOGPFAULTERRORBOX);
    if(!write_code(output,0x31425049))return 1;
    for(;;) {
        uint32_t size=0, error=0;
        if(!read_all(input,&size,4))break;
        if(size<20||size>131072||(size&1))return 2;
        BYTE *data=(BYTE*)HeapAlloc(GetProcessHeap(),0,size);
        if(!data)return 3;
        if(!read_all(input,data,size)){HeapFree(GetProcessHeap(),0,data);break;}
        target=NULL; count=0;
        EnumWindows(find_target,0);
        if(count!=1)error=0xA001; /* refuse ambiguous or absent targets */
        else if(size==20 && ((uint32_t*)data)[0]==0x49555641) {
            uint32_t *v=(uint32_t*)data;
            display=NULL;EnumChildWindows(target,find_display,0);
            if(!display)error=0xA003;
            else if(v[1]==1)error=capture();
            else if(v[1]==2)error=key(v[2],v[3],v[4]&1,v[4]&2);
            else if(v[1]==3) {for(unsigned i=0;i<256;i++)if(held[i]){uint32_t e=key(i,0,0,0);if(e)error=e;}}
            else error=0xA004;
        }
        else {
            COPYDATASTRUCT cds;
            DWORD_PTR result=0;
            cds.dwData=0xA7000001; cds.cbData=size; cds.lpData=data;
            if(!SendMessageTimeoutW(target,WM_COPYDATA,(WPARAM)target,(LPARAM)&cds,
                                    SMTO_ABORTIFHUNG|SMTO_BLOCK,5000,&result)) {
                error=GetLastError(); if(!error)error=0xA002;
            }
        }
        HeapFree(GetProcessHeap(),0,data);
        if(!write_code(output,error))break;
    }
    return 0;
}
