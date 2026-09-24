import os
import ftplib
import time
import sys

FTP_HOST = "ftpupload.net"
FTP_USER = "if0_42995871"
FTP_PASS = "Coderebels2026"
REMOTE_BASE = "/htdocs"

ROOT_DIR = r"C:\laragon\www\CMS"

SKIP_FILES = {
    'Buenabentura.png', 'Gabayan.png', 'Giray.png', 'Gochaico.png', 'Salas.png'
}

def get_ftp():
    for attempt in range(5):
        try:
            ftp = ftplib.FTP(FTP_HOST, timeout=30)
            ftp.login(FTP_USER, FTP_PASS)
            ftp.set_pasv(True)
            return ftp
        except Exception as e:
            print(f"Connection attempt {attempt+1} failed: {e}. Retrying in 3s...")
            time.sleep(3)
    raise RuntimeError("Could not connect to FTP after 5 attempts.")

def ensure_remote_dir(ftp, remote_dir):
    parts = [p for p in remote_dir.replace('\\', '/').split('/') if p]
    current = ""
    for part in parts:
        current += "/" + part
        try:
            ftp.cwd(current)
        except Exception:
            try:
                ftp.mkd(current)
                ftp.cwd(current)
            except Exception as e:
                pass

def upload_file(ftp, local_path, remote_path):
    remote_dir = os.path.dirname(remote_path).replace('\\', '/')
    filename = os.path.basename(remote_path)
    
    for attempt in range(3):
        try:
            ftp.cwd(remote_dir)
            with open(local_path, "rb") as f:
                ftp.storbinary(f"STOR {filename}", f)
            return True
        except Exception as e:
            print(f"  Warning: failed to upload {filename} ({e}). Reconnecting...")
            time.sleep(2)
            try:
                ftp.quit()
            except Exception:
                pass
            ftp = get_ftp()
    print(f"  ERROR: Could not upload {filename} after 3 attempts.")
    return False

def main():
    print(f"Connecting to {FTP_HOST} as {FTP_USER}...")
    ftp = get_ftp()
    print("FTP connected successfully!")

    # Verify htdocs
    ensure_remote_dir(ftp, REMOTE_BASE)
    ftp.cwd(REMOTE_BASE)

    # 1. Upload root files
    print("\n--- Uploading root files ---")
    root_files = [
        (os.path.join(ROOT_DIR, "index.php"), f"{REMOTE_BASE}/index.php"),
        (os.path.join(ROOT_DIR, ".htaccess"), f"{REMOTE_BASE}/.htaccess"),
        (os.path.join(ROOT_DIR, ".env.production"), f"{REMOTE_BASE}/.env"),
    ]
    for local_f, remote_f in root_files:
        if os.path.exists(local_f):
            print(f"Uploading {os.path.basename(remote_f)}...")
            upload_file(ftp, local_f, remote_f)

    # 2. Upload directories: assets, backend, frontend
    dirs_to_upload = ["assets", "backend", "frontend"]
    
    total_files = 0
    all_upload_list = []
    
    for d in dirs_to_upload:
        local_dir = os.path.join(ROOT_DIR, d)
        for root, dirs, files in os.walk(local_dir):
            rel_path = os.path.relpath(root, ROOT_DIR).replace('\\', '/')
            # Skip logs
            if "storage/logs" in rel_path or "storage\\logs" in rel_path:
                continue
            
            for file in files:
                if file in SKIP_FILES:
                    continue
                if file.endswith('.sql') and 'database' in rel_path:
                    continue # skip large SQL backups on live
                
                local_file_path = os.path.join(root, file)
                remote_file_path = f"{REMOTE_BASE}/{rel_path}/{file}".replace('\\', '/')
                all_upload_list.append((local_file_path, remote_file_path))

    print(f"\n--- Uploading {len(all_upload_list)} files to {REMOTE_BASE}... ---")
    
    # Collect unique remote directories and ensure them
    unique_dirs = set(os.path.dirname(r).replace('\\', '/') for _, r in all_upload_list)
    for d in sorted(unique_dirs):
        ensure_remote_dir(ftp, d)

    success_count = 0
    start_time = time.time()
    
    for i, (loc, rem) in enumerate(all_upload_list, 1):
        rel_disp = rem.replace(REMOTE_BASE + "/", "")
        sys.stdout.write(f"\r[{i}/{len(all_upload_list)}] Uploading: {rel_disp[:60]:<60}")
        sys.stdout.flush()
        if upload_file(ftp, loc, rem):
            success_count += 1
            
    elapsed = round(time.time() - start_time, 1)
    print(f"\n\nUpload completed! Successfully uploaded {success_count}/{len(all_upload_list)} files in {elapsed}s.")
    
    try:
        ftp.quit()
    except Exception:
        pass

if __name__ == "__main__":
    main()
