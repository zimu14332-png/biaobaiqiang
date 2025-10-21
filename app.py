from __future__ import annotations

import os
import uuid
from datetime import datetime

from flask import (
    Flask,
    render_template,
    request,
    redirect,
    url_for,
    flash,
)
from flask_sqlalchemy import SQLAlchemy
from werkzeug.utils import secure_filename
from PIL import Image


# -----------------------------------------------------------------------------
# App configuration
# -----------------------------------------------------------------------------
app = Flask(__name__)
app.config["SECRET_KEY"] = os.environ.get("SECRET_KEY", "dev-secret-key")
app.config["MAX_CONTENT_LENGTH"] = 10 * 1024 * 1024  # 10 MB upload limit

BASE_DIR = os.path.abspath(os.path.dirname(__file__))
UPLOAD_FOLDER = os.path.join(BASE_DIR, "static", "uploads")
os.makedirs(UPLOAD_FOLDER, exist_ok=True)
app.config["UPLOAD_FOLDER"] = UPLOAD_FOLDER

ALLOWED_EXTENSIONS = {"png", "jpg", "jpeg", "gif", "webp"}

# Database (SQLite)
app.config["SQLALCHEMY_DATABASE_URI"] = "sqlite:///confessions.db"
app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False

db = SQLAlchemy(app)


# -----------------------------------------------------------------------------
# Models
# -----------------------------------------------------------------------------
class Post(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(120), nullable=False)
    description = db.Column(db.Text, nullable=False)
    image_filename = db.Column(db.String(255), nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)


# Create tables if they do not exist
with app.app_context():
    db.create_all()


# -----------------------------------------------------------------------------
# Helpers
# -----------------------------------------------------------------------------

def is_allowed_file(filename: str) -> bool:
    if not filename or "." not in filename:
        return False
    ext = filename.rsplit(".", 1)[1].lower()
    return ext in ALLOWED_EXTENSIONS


def is_valid_image(file_storage) -> bool:
    """Best-effort validation that uploaded file is an image using Pillow."""
    try:
        position = file_storage.stream.tell()
        file_storage.stream.seek(0)
        Image.open(file_storage.stream).verify()
        file_storage.stream.seek(position)
        return True
    except Exception:
        return False


# -----------------------------------------------------------------------------
# Routes
# -----------------------------------------------------------------------------
@app.route("/")
def index():
    posts = Post.query.order_by(Post.created_at.desc()).all()
    return render_template("index.html", posts=posts)


@app.route("/upload", methods=["GET", "POST"])
def upload():
    if request.method == "POST":
        name = (request.form.get("name") or "").strip()
        description = (request.form.get("description") or "").strip()
        file = request.files.get("image")

        if not name:
            flash("请填写你的昵称或称呼。", "error")
            return redirect(request.url)
        if not description:
            flash("请填写介绍或想说的话。", "error")
            return redirect(request.url)
        if not file or file.filename == "":
            flash("请选择一张图片。", "error")
            return redirect(request.url)
        if not is_allowed_file(file.filename):
            flash("仅支持 PNG/JPG/JPEG/GIF/WEBP 格式。", "error")
            return redirect(request.url)
        if not is_valid_image(file):
            flash("文件似乎不是有效的图片。", "error")
            return redirect(request.url)

        # Generate a unique filename while preserving extension
        original_name = secure_filename(file.filename)
        _, ext = os.path.splitext(original_name)
        unique_filename = f"{uuid.uuid4().hex}{ext.lower()}"
        save_path = os.path.join(app.config["UPLOAD_FOLDER"], unique_filename)

        # Save the file
        file.save(save_path)

        # Persist post
        post = Post(name=name[:120], description=description[:2000], image_filename=unique_filename)
        db.session.add(post)
        db.session.commit()

        flash("发布成功！", "success")
        return redirect(url_for("index"))

    return render_template("upload.html")


# Error handlers
@app.errorhandler(413)
def request_entity_too_large(_):
    flash("图片太大，最大允许 10MB。", "error")
    return redirect(request.url if request.method == "POST" else url_for("upload"))


if __name__ == "__main__":
    # Bind to all interfaces so it's reachable in container environments
    app.run(host="0.0.0.0", port=5000, debug=True)
