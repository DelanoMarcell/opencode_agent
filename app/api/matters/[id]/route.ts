import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth";
import { connectDB } from "@/lib/mongodb";
import { Matter } from "@/lib/models/matter";
import { MatterMember } from "@/lib/models/matter-member";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

function serializeMatter(matter: {
  _id: { toString(): string };
  code: string;
  title: string;
  description?: string;
  ownerUserId: { toString(): string };
  status: "active" | "archived";
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: matter._id.toString(),
    code: matter.code,
    title: matter.title,
    description: matter.description ?? undefined,
    ownerUserId: matter.ownerUserId.toString(),
    status: matter.status,
    createdAt: matter.createdAt.toISOString(),
    updatedAt: matter.updatedAt.toISOString(),
  };
}

async function getAuthenticatedUser() {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    return null;
  }

  return session.user;
}

async function userCanAccessMatter(matterId: string, userId: string) {
  const membership = await MatterMember.findOne({ matterId, userId }).lean();
  return Boolean(membership);
}

export async function PATCH(req: Request, { params }: RouteContext) {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  try {
    const { code, title, description } = await req.json();

    const trimmedCode = typeof code === "string" ? code.trim() : "";
    const trimmedTitle = typeof title === "string" ? title.trim() : "";
    const trimmedDescription =
      typeof description === "string" ? description.trim() : "";

    if (!trimmedCode || !trimmedTitle) {
      return NextResponse.json(
        { error: "Matter code and title are required" },
        { status: 400 }
      );
    }

    await connectDB();

    if (!(await userCanAccessMatter(id, user.id))) {
      return NextResponse.json({ error: "Matter not found" }, { status: 404 });
    }

    const matter = await Matter.findByIdAndUpdate(
      id,
      {
        code: trimmedCode.toUpperCase(),
        title: trimmedTitle,
        description: trimmedDescription || undefined,
      },
      {
        returnDocument: "after",
        runValidators: true,
      }
    ).lean();

    if (!matter) {
      return NextResponse.json({ error: "Matter not found" }, { status: 404 });
    }

    return NextResponse.json({
      matter: serializeMatter(matter),
    });
  } catch (error) {
    const duplicateCode =
      Boolean(
        error &&
          typeof error === "object" &&
          "code" in error &&
          (error as { code?: number }).code === 11000
      ) ||
      (error instanceof Error && error.message.includes("duplicate key"));

    return NextResponse.json(
      { error: duplicateCode ? "Matter code already exists" : "Failed to update matter" },
      { status: duplicateCode ? 409 : 500 }
    );
  }
}
