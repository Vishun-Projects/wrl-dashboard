import os
import sys
import glob
import email
from email.policy import default

def find_maildirs():
    search_patterns = [
        '/home/*/Maildir',
        '/var/mail/*/Maildir',
        '/var/mail/*',
        '/root/Maildir',
        '/home/*',
        '/var/spool/mail/*',
    ]
    found = []
    for pattern in search_patterns:
        for path in glob.glob(pattern):
            if os.path.isdir(path):
                # Check for Maildir subfolders 'new' or 'cur'
                if os.path.isdir(os.path.join(path, 'new')) or os.path.isdir(os.path.join(path, 'cur')):
                    found.append(os.path.abspath(path))
    return list(set(found))

def extract_attachments(maildir_path, out_dir):
    os.makedirs(out_dir, exist_ok=True)
    extracted_count = 0

    # Process both 'new' and 'cur' directories
    for sub in ['new', 'cur']:
        dir_path = os.path.join(maildir_path, sub)
        if not os.path.isdir(dir_path):
            continue

        print(f"Scanning: {dir_path}")
        files = glob.glob(os.path.join(dir_path, '*'))
        for filepath in files:
            if not os.path.isfile(filepath):
                continue
            try:
                with open(filepath, 'rb') as f:
                    msg = email.message_from_bytes(f.read(), policy=default)

                # Check date to print context
                subject = msg.get('subject', '(No Subject)')
                date = msg.get('date', '(No Date)')

                for part in msg.walk():
                    if part.get_content_maintype() == 'multipart':
                        continue
                    filename = part.get_filename()
                    if filename and ('.htm' in filename.lower() or '.html' in filename.lower()):
                        payload = part.get_payload(decode=True)
                        if payload:
                            # Sanitize filename
                            clean_filename = "".join(c for c in filename if c.isalnum() or c in "._- ")
                            # To avoid collisions, prefix with mail file base name
                            file_base = os.path.basename(filepath)
                            out_name = f"{file_base}_{clean_filename}"
                            out_path = os.path.join(out_dir, out_name)
                            with open(out_path, 'wb') as out_f:
                                out_f.write(payload)
                            print(f" -> Extracted: {out_name} (Subject: {subject}, Date: {date})")
                            extracted_count += 1
            except Exception as e:
                print(f"Error processing {filepath}: {e}")

    return extracted_count

def main():
    out_dir = '/tmp/extracted_sap'
    maildirs = find_maildirs()

    if not maildirs:
        print("No Maildir directories found on the system.")
        print("Please check configuration or run: find / -name '*Maildir*' -type d 2>/dev/null")
        return

    print(f"Found Maildir(s): {maildirs}")
    total_extracted = 0
    for maildir in maildirs:
        print(f"\nProcessing Maildir: {maildir}")
        total_extracted += extract_attachments(maildir, out_dir)

    print(f"\nFinished. Total files extracted: {total_extracted}")
    print(f"Extracted files are located in: {out_dir}")

if __name__ == '__main__':
    main()
